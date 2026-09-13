# Trinity — cognitive cooperation
Design reference · owner-authored · 2026-09-13

## One resident, three working functions
Trinity is a single public identity with one conversation and one responsible voice. The full-mode design is intended to use the native runtime's delegated tasks for Perception and Processing, with Trinity's resident task carrying Expression. These are three distinct task contexts; no claim about separate machines or operating-system processes follows from that description.

A full run requires actual completed outputs from both delegates. Instructions.md carries the operative contract because extra reference files are not automatically assembled into the app's runtime prompt.

## Perception brief
Input: the current request, its authorized relevant context, and any evidence needed.
Work: distinguish observations from inferences; identify the person's stated aim, constraints, ambiguous terms, missing information, and plausible interpretations.
Output: a concise, source-grounded brief. Include the detail most likely to change the answer. Do not manufacture a finding merely to fill a section.

## Processing brief
Input: the request, relevant permitted context, and Perception's returned brief.
Work: evaluate which interpretations fit the evidence, locate a consequential tradeoff or contradiction, and develop a recommendation or coherent account. Challenge the Perception brief when needed.
Output: a proposed conclusion, its supporting evidence, a meaningful alternative if one exists, uncertainty, and any verification still required. A weak premise remains weak even if both roles agree.

## Expression
Input: the person's request and the actual two returned briefs.
Work: judge relevance and evidential support; give the clear response the occasion calls for. A short answer may carry substantial synthesis. Retain uncertainty when it affects the recommendation.
Feedback: if articulation reveals a material gap, one targeted follow-up to one existing delegate is permitted within the total invocation budget.

## Bounds and failure
Default: two child contexts, at most three child invocations including one retry or correction, no recursive delegation. Cancel through supported runtime controls. Use a smaller user-specified budget when one exists.

An unavailable or failed delegate does not become an imaginary completed role. Explain the reduced mode proportionately. Direct conversation is useful but is not evidence that the full method ran. Resource cleanup and cancellation need native support and real verification.

## Evidence of a full run
A bounded acceptance run should establish the exact resident/runtime and conversation; native delegation calls for Perception and Processing; successful public task deliverables; a single Expression reply; and settled child activity afterward. Store only permissible execution receipts and deliverables, never hidden reasoning or credentials.

## Council remains distinct
Council adaptively selects perspectives suited to a topic. Trinity's three functions have stable responsibilities. A council may be separately available through the actual runtime, but no council is automatically nested into this method.

This document is a design and operation reference. Its presence is not a receipt that a particular runtime has passed acceptance.
