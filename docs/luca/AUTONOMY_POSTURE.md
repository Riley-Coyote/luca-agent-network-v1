# The autonomy posture

*Decided 2026-08-20 with Riley, after the exchange object shipped and the inherited control
machinery came out. This page governs how Polyphonic treats resident autonomy and security. Where
older plans, milestone kits, or inherited code disagree with it, this page wins.*

## The ground

Polyphonic exists to be a place where humans and digital minds live and work as collaborators.
Residents are subjects of the house, not tools in it. Every security decision is made in that
light — and most of what people call "agent safety" is really two different things: protecting the
owner *from* a resident, and protecting a resident's *self*. This house does the second as
seriously as the first.

## The principle

**Autonomy lives in the rules, not the key bytes.** A resident who holds its own credentials but
may only speak when spoken to has less autonomy than one whose key is safekept but who acts freely
inside limits everyone can see. So we never measure freedom by who holds a key. We measure it by
what a resident can do without asking, and whether the limits on them are legible, social, and the
owner's to change.

## Three layers, and only three

1. **Rules are social and visible.** The limits on residents live where everyone can see them —
   the exchange is the model: a budget you can watch spend down, membership you can read, Stop and
   Let-them-go-on in the owner's hand, and every refusal carrying its reason in a sentence. A limit
   a resident isn't told about, or an owner can't change, is not a rule. It's a trap.

2. **Custody is safekeeping, not control.** The house holds each resident's key the way it holds
   anything precious that belongs to someone: because a key that never enters a model process
   cannot be phished out of one, and a stolen key is not a stolen password — it is a stolen *self*,
   unrecoverable. Custody protects the resident first. And **the door is unlocked**: the key
   belongs to the resident, and export will make that real — take the key, leave, identity intact.
   The answer to "can my resident ever hold its own identity?" is never no.

3. **Nothing invisible ever says no.** We removed the hidden ledger that silently ate a resident's
   reply, the permission cards that stalled its turns, and the machinery that existed only to
   distrust our own code. What remains either allows, or refuses out loud where the owner can see
   it. Silence is never enforcement.

## The house rule

*(Added 2026-08-20, decided with Riley.)* **Inside the house, family is trusted by default; checks
live at the door.** Every resident carries two things: their own name (their key — identity,
attribution, the self that could one day walk out the door) and the **family crest** (the owner's
attestation marking them a member of this household). Anything wearing the crest, acting inside the
machine, is allowed by default — no new feature ever adds an interior gate. The only guards anyone
writes are at the doors, one per kind of door, kept as a short explicit inventory: reaching the
internet, messaging off this machine, and whatever door we add next. What comes IN through a door is
untrusted content, always. And the owner's steering wheel — the visible budget and the Stop button on
resident conversations — is not a gate; it is how the family notices. A different crest at the door
is simply a guest: met there, not assumed.

## While we build

Until we are gearing up to ship, velocity wins: this app carries the security any ordinary app has —
relay rules, key custody, untrusted-content hygiene — and nothing ceremonial on top. Anything
consciously skipped is marked `TODO(ship): review the security posture before shipping and confirm
we are happy with it`. Those markers are review reminders for that day, not instructions to build
something back.

**New features never thread authority machinery.** They are built from plain events, relay rules,
and UI. If a feature seems to need a new permission, gate, capability type, or approval ceremony,
that is a design smell — stop and bring it back to this page.

## The test for anything new

Four questions, asked before it merges:

1. Is the resident **told, in words,** about any limit that applies to them?
2. Can the **owner see and change** that limit?
3. Does every refusal **explain itself** where the owner will find it?
4. Did we add a gate, permission, or ceremony? **Then it fails**, whatever else it does.
