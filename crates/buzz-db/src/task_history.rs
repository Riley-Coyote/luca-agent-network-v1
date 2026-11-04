//! Durable task replay authority. Revocation cannot be undone by event deletion,
//! duplicate grant replay, or removing and re-adding a room member.
use crate::{DbError, Result};

pub(crate) async fn revoke_source_pg(
    pool: &PgPool,
    community: CommunityId,
    source: Uuid,
    reader: &[u8],
) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT id FROM channels WHERE community_id=$1 AND id=$2 FOR UPDATE")
        .bind(community.as_uuid())
        .bind(source)
        .fetch_optional(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO task_history_source_revocations VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    )
    .bind(community.as_uuid())
    .bind(source)
    .bind(reader)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE task_history_authority SET revoked=TRUE WHERE community_id=$1 AND channel_id=$2 AND (reader=$3 OR owner=$3)")
        .bind(community.as_uuid()).bind(source).bind(reader).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn revoke_source_sqlite(
    pool: &SqlitePool,
    community: CommunityId,
    source: Uuid,
    reader: &[u8],
) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE channels SET id=id WHERE community_id=?1 AND id=?2")
        .bind(community.as_uuid().to_string())
        .bind(source.to_string())
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO task_history_source_revocations VALUES(?1,?2,?3) ON CONFLICT DO NOTHING",
    )
    .bind(community.as_uuid().to_string())
    .bind(source.to_string())
    .bind(reader)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE task_history_authority SET revoked=1 WHERE community_id=?1 AND channel_id=?2 AND (reader=?3 OR owner=?3)")
        .bind(community.as_uuid().to_string()).bind(source.to_string()).bind(reader).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
use buzz_core::CommunityId;
use sqlx::{PgPool, SqlitePool};
use uuid::Uuid;

/// Fixed task grant coordinates; issuer and audience have already been checked against the exchange.
pub struct Grant<'a> {
    /// Host-resolved community.
    pub community: CommunityId,
    /// Signing owner.
    pub owner: &'a [u8],
    /// Canonical exchange ID.
    pub exchange: &'a str,
    /// Exact source.
    pub source: Uuid,
    /// Exact resident audience.
    pub readers: &'a [Vec<u8>],
    /// Original active grant event, never replaced by revocation.
    pub event: &'a [u8],
    /// A revoke is sticky; regrant requires a new explicit task authority.
    pub revoke: bool,
}

pub(crate) async fn write_pg(pool: &PgPool, g: &Grant<'_>) -> Result<()> {
    let mut tx = pool.begin().await?;
    // Same source lock as member removal: grant and revoke cannot cross each other.
    let exists = sqlx::query(
        "SELECT id FROM channels WHERE community_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(g.community.as_uuid())
    .bind(g.source)
    .fetch_optional(&mut *tx)
    .await?;
    if exists.is_none() {
        return Err(DbError::AccessDenied("task source unavailable".into()));
    }
    if !g.revoke {
        for key in std::iter::once(g.owner).chain(g.readers.iter().map(Vec::as_slice)) {
            let revoked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM task_history_source_revocations WHERE community_id=$1 AND channel_id=$2 AND reader=$3)")
                .bind(g.community.as_uuid()).bind(g.source).bind(key).fetch_one(&mut *tx).await?;
            if revoked {
                return Err(DbError::AccessDenied(
                    "task history source explicitly revoked".into(),
                ));
            }
            let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channel_members WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3 AND removed_at IS NULL)")
                .bind(g.community.as_uuid()).bind(g.source).bind(key).fetch_one(&mut *tx).await?;
            if !active {
                return Err(DbError::AccessDenied(
                    "task history issuance requires current source audience".into(),
                ));
            }
        }
    }
    for reader in g.readers {
        sqlx::query("INSERT INTO task_history_authority (community_id,owner,exchange_id,channel_id,reader,grant_event_id,revoked) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (community_id,owner,exchange_id,reader) DO NOTHING")
            .bind(g.community.as_uuid()).bind(g.owner).bind(g.exchange).bind(g.source).bind(reader).bind(g.event).bind(g.revoke).execute(&mut *tx).await?;
        if g.revoke {
            sqlx::query("UPDATE task_history_authority SET revoked=TRUE WHERE community_id=$1 AND owner=$2 AND exchange_id=$3 AND reader=$4")
                .bind(g.community.as_uuid()).bind(g.owner).bind(g.exchange).bind(reader).execute(&mut *tx).await?;
        } else {
            let matches: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM task_history_authority WHERE community_id=$1 AND owner=$2 AND exchange_id=$3 AND reader=$4 AND channel_id=$5 AND grant_event_id=$6 AND revoked=FALSE)")
                .bind(g.community.as_uuid()).bind(g.owner).bind(g.exchange).bind(reader).bind(g.source).bind(g.event).fetch_one(&mut *tx).await?;
            if !matches {
                return Err(DbError::AccessDenied(
                    "task history grant is immutable or revoked".into(),
                ));
            }
        }
    }
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn write_sqlite(pool: &SqlitePool, g: &Grant<'_>) -> Result<()> {
    let mut tx = pool.begin().await?;
    let community = g.community.as_uuid().to_string();
    let source = g.source.to_string();
    // Acquire the SQLite writer lock before reading memberships.
    let exists = sqlx::query(
        "UPDATE channels SET id=id WHERE community_id=?1 AND id=?2 AND deleted_at IS NULL",
    )
    .bind(&community)
    .bind(&source)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if exists == 0 {
        return Err(DbError::AccessDenied("task source unavailable".into()));
    }
    if !g.revoke {
        for key in std::iter::once(g.owner).chain(g.readers.iter().map(Vec::as_slice)) {
            let revoked: i64 = sqlx::query_scalar("SELECT count(*) FROM task_history_source_revocations WHERE community_id=?1 AND channel_id=?2 AND reader=?3")
                .bind(&community).bind(&source).bind(key).fetch_one(&mut *tx).await?;
            if revoked != 0 {
                return Err(DbError::AccessDenied(
                    "task history source explicitly revoked".into(),
                ));
            }
            let active: i64 = sqlx::query_scalar("SELECT count(*) FROM channel_members WHERE channel_id=?1 AND pubkey=?2 AND removed_at IS NULL")
                .bind(&source).bind(key).fetch_one(&mut *tx).await?;
            if active != 1 {
                return Err(DbError::AccessDenied(
                    "task history issuance requires current source audience".into(),
                ));
            }
        }
    }
    for reader in g.readers {
        sqlx::query("INSERT INTO task_history_authority (community_id,owner,exchange_id,channel_id,reader,grant_event_id,revoked) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT (community_id,owner,exchange_id,reader) DO NOTHING")
            .bind(&community).bind(g.owner).bind(g.exchange).bind(&source).bind(reader).bind(g.event).bind(g.revoke).execute(&mut *tx).await?;
        if g.revoke {
            sqlx::query("UPDATE task_history_authority SET revoked=1 WHERE community_id=?1 AND owner=?2 AND exchange_id=?3 AND reader=?4")
                .bind(&community).bind(g.owner).bind(g.exchange).bind(reader).execute(&mut *tx).await?;
        } else {
            let matches: i64 = sqlx::query_scalar("SELECT count(*) FROM task_history_authority WHERE community_id=?1 AND owner=?2 AND exchange_id=?3 AND reader=?4 AND channel_id=?5 AND grant_event_id=?6 AND revoked=0")
                .bind(&community).bind(g.owner).bind(g.exchange).bind(reader).bind(&source).bind(g.event).fetch_one(&mut *tx).await?;
            if matches != 1 {
                return Err(DbError::AccessDenied(
                    "task history grant is immutable or revoked".into(),
                ));
            }
        }
    }
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn permits_pg(pool: &PgPool, g: &Grant<'_>, reader: &[u8]) -> Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM task_history_authority t JOIN channels c ON c.community_id=t.community_id AND c.id=t.channel_id WHERE t.community_id=$1 AND t.owner=$2 AND t.exchange_id=$3 AND t.channel_id=$4 AND t.reader=$5 AND t.grant_event_id=$6 AND t.revoked=FALSE AND c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM task_history_source_revocations r WHERE r.community_id=t.community_id AND r.channel_id=t.channel_id AND (r.reader=t.reader OR r.reader=t.owner)))")
        .bind(g.community.as_uuid()).bind(g.owner).bind(g.exchange).bind(g.source).bind(reader).bind(g.event).fetch_one(pool).await?)
}

pub(crate) async fn permits_sqlite(
    pool: &SqlitePool,
    g: &Grant<'_>,
    reader: &[u8],
) -> Result<bool> {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM task_history_authority t JOIN channels c ON c.community_id=t.community_id AND c.id=t.channel_id WHERE t.community_id=?1 AND t.owner=?2 AND t.exchange_id=?3 AND t.channel_id=?4 AND t.reader=?5 AND t.grant_event_id=?6 AND t.revoked=0 AND c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM task_history_source_revocations r WHERE r.community_id=t.community_id AND r.channel_id=t.channel_id AND (r.reader=t.reader OR r.reader=t.owner))")
        .bind(g.community.as_uuid().to_string()).bind(g.owner).bind(g.exchange).bind(g.source.to_string()).bind(reader).bind(g.event).fetch_one(pool).await?;
    Ok(count == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channel::{ChannelType, ChannelVisibility, MemberRole};

    #[tokio::test]
    async fn automatic_departure_preserves_but_explicit_removal_stays_revoked_after_rejoin() {
        let pool = crate::sqlite::connect(":memory:").await.unwrap();
        let community = crate::sqlite::ensure_configured_community(&pool, "task-history.test")
            .await
            .unwrap()
            .id;
        let owner = vec![1; 32];
        let reader = vec![2; 32];
        let event = vec![3; 32];
        crate::sqlite::ensure_user(&pool, community, &owner)
            .await
            .unwrap();
        crate::sqlite::ensure_user(&pool, community, &reader)
            .await
            .unwrap();
        let channel = crate::sqlite::create_channel(
            &pool,
            community,
            "task",
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &owner,
            None,
        )
        .await
        .unwrap();
        crate::sqlite::add_member(
            &pool,
            community,
            channel.id,
            &reader,
            MemberRole::Member,
            Some(&owner),
        )
        .await
        .unwrap();
        let readers = vec![reader.clone()];
        let exchange = "a".repeat(64);
        let grant = Grant {
            community,
            owner: &owner,
            exchange: &exchange,
            source: channel.id,
            readers: &readers,
            event: &event,
            revoke: false,
        };
        write_sqlite(&pool, &grant).await.unwrap();
        assert!(permits_sqlite(&pool, &grant, &reader).await.unwrap());
        assert!(!permits_sqlite(&pool, &grant, &[9; 32]).await.unwrap());
        crate::sqlite::remove_member_with_task_history(
            &pool,
            community,
            channel.id,
            &reader,
            &owner,
            Some(&exchange),
        )
        .await
        .unwrap();
        assert!(
            !crate::sqlite::is_member(&pool, community, channel.id, &reader)
                .await
                .unwrap()
        );
        assert!(permits_sqlite(&pool, &grant, &reader).await.unwrap());
        // Explicit revoke works even after transient membership already ended.
        crate::sqlite::add_member_with_task_history(
            &pool,
            community,
            channel.id,
            &reader,
            MemberRole::Guest,
            Some(&owner),
            Some(&exchange),
        )
        .await
        .unwrap();
        crate::sqlite::remove_member_with_task_history(
            &pool,
            community,
            channel.id,
            &reader,
            &owner,
            Some(&exchange),
        )
        .await
        .unwrap();
        crate::sqlite::remove_member(&pool, community, channel.id, &reader, &owner)
            .await
            .unwrap();
        assert!(!permits_sqlite(&pool, &grant, &reader).await.unwrap());
        assert!(crate::sqlite::add_member_with_task_history(
            &pool,
            community,
            channel.id,
            &reader,
            MemberRole::Guest,
            Some(&owner),
            Some(&exchange)
        )
        .await
        .is_err());
        assert!(
            !crate::sqlite::is_member(&pool, community, channel.id, &reader)
                .await
                .unwrap()
        );
        crate::sqlite::add_member(
            &pool,
            community,
            channel.id,
            &reader,
            MemberRole::Member,
            Some(&owner),
        )
        .await
        .unwrap();
        assert!(write_sqlite(&pool, &grant).await.is_err());
        assert!(!permits_sqlite(&pool, &grant, &reader).await.unwrap());
        // A different exchange cannot evade explicit source revocation either.
        let other_exchange = "b".repeat(64);
        let other = Grant {
            exchange: &other_exchange,
            ..grant
        };
        assert!(write_sqlite(&pool, &other).await.is_err());
    }

    #[tokio::test]
    async fn revoke_tombstone_prevents_late_active_grant() {
        let pool = crate::sqlite::connect(":memory:").await.unwrap();
        let community = crate::sqlite::ensure_configured_community(&pool, "task-revoke.test")
            .await
            .unwrap()
            .id;
        let owner = vec![1; 32];
        let reader = vec![2; 32];
        let event = vec![3; 32];
        let readers = vec![reader.clone()];
        crate::sqlite::ensure_user(&pool, community, &owner)
            .await
            .unwrap();
        let channel = crate::sqlite::create_channel(
            &pool,
            community,
            "task",
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &owner,
            None,
        )
        .await
        .unwrap();
        let exchange = "a".repeat(64);
        let mut grant = Grant {
            community,
            owner: &owner,
            exchange: &exchange,
            source: channel.id,
            readers: &readers,
            event: &event,
            revoke: true,
        };
        write_sqlite(&pool, &grant).await.unwrap();
        assert!(!permits_sqlite(&pool, &grant, &reader).await.unwrap());
        grant.revoke = false;
        assert!(write_sqlite(&pool, &grant).await.is_err());
    }
}
