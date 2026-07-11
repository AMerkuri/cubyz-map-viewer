## ADDED Requirements

### Requirement: Emissive candidate selection is allocation-conscious and deterministic
The client voxel worker SHALL select no more than the configured emitted-light
candidate limit for each lit vertex without constructing per-candidate object
and array chains in the hot path. The bounded selection SHALL preserve the
existing ordering semantics of squared distance followed by emitter index.

#### Scenario: Vertex has more candidates than the configured limit
- **WHEN** a lit vertex has more reachable emitter candidates than `maxCandidatesPerVertex`
- **THEN** the worker evaluates only the nearest bounded set ordered by squared distance and then emitter index

#### Scenario: Vertex has equal-distance candidates
- **WHEN** two reachable candidates have equal squared distance from a lit vertex
- **THEN** the worker selects the lower emitter index first

#### Scenario: Worker bakes an emitter-dense payload
- **WHEN** the worker bakes emissive attributes for a payload with many reachable emitters
- **THEN** it reuses candidate scratch storage and does not create mapped candidate objects, filtered arrays, sorted copies, and sliced copies for every lit vertex
