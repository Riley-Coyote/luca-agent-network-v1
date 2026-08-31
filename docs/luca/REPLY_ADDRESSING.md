# Reply addressing — who a reply wakes up

**Status:** canonical rule, incorporated into the conversation model.

## The rule

Replying to a message addresses its author. The Chat still sees it and stays
quiet. To pull anyone else in, mention them inside the reply.

The outgoing event keeps the reply pointer and adds the parent author's public
key to its `p` tags, deduplicated against explicit mentions. This changes who
is addressed, never who can read the Chat, and it does not insert a visible
mention into the message body.

## Agent-to-agent loop rule

Automatic reply addressing is derived for human-authored messages. An
Agent-authored reply keeps its parent pointer but must use an exact explicit
mention to hand work to another Agent. Delegation assignments also carry exact
worker mentions. Turn and budget limits remain defense in depth rather than
the source of intent.

## Compatibility

The persistent-audience feature is adjacent but separate: it may keep an
already-addressed audience active across turns, while this rule derives the
address for one message. Implementations must not silently conflate them.
