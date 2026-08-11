# Polyphonic conversation experience verdict

Status: **PASS**

Exact product checkpoint:
`4df383309b750311d796be9bee72f3969231e001`

Polyphonic now preserves Buzz's signed messaging transport while presenting
managed residents as a familiar, linear conversation. Normal group messages
activate every ready resident, mentions activate the requested subset, directed
replies wake only their target, and explicit threads remain intentionally
separate. Each activated resident receives an independent provisional working
row and public streaming surface that is atomically replaced by its signed
final.

Repeated parent quotes, synthetic linear reply counters, known runtime notices,
persistent handoff banners, and internal cancellation controls no longer enter
the normal transcript. Cancellation can stop one resident without holding the
others, or stop the full conversation.

The exact Developer-ID-signed application passed the installed direct, group,
directed, mentioned-subset, explicit-thread, streaming, cancellation, and
relaunch matrix. Focused checks and the complete `just ci` gate passed on the
unchanged product checkpoint. No push or pull request was authorized.

## Commit lineage

| Commit | Purpose |
|---|---|
| `4c04dc3` | Freeze conversation audience and response contracts |
| `423c5f1` | Separate message delivery from resident activation |
| `7d4f6d3` | Publish managed responses as linear conversation turns |
| `e94857d` | Add secure provisional response streaming |
| `4df3833` | Refine conversation interaction and activity presentation; exact product checkpoint |
| evidence commit | Finalize installed messaging acceptance evidence |

Detailed artifact identity, the installed matrix, native-boundary notes, and
verification results are recorded in `CONVERSATION_ACCEPTANCE.md`.
