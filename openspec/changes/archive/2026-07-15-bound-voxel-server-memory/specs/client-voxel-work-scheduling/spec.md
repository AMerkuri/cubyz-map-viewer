## ADDED Requirements

### Requirement: Server capacity responses remain retryable demand
The client voxel fetch scheduler SHALL classify `503 Service Unavailable` responses with server retry guidance as temporary admission pressure. It SHALL release the active fetch slot, SHALL NOT consume the tile's permanent generation-failure budget, and SHALL retry only while the tile remains demanded through the normal prioritized scheduler.

#### Scenario: Required coverage receives overload response
- **WHEN** a demanded coverage request receives a server-capacity `503` response
- **THEN** the client releases fetch capacity and keeps the tile eligible for a delayed prioritized retry without counting a permanent failure

#### Scenario: Optional detail leaves demand after overload
- **WHEN** a detail request receives a server-capacity response and leaves active demand before its retry becomes eligible
- **THEN** the client does not retry that obsolete request

#### Scenario: Retry guidance is present
- **WHEN** the server provides a valid `Retry-After` value with a capacity response
- **THEN** the client does not re-admit that tile before the indicated delay and continues scheduling other eligible work

#### Scenario: Non-capacity server error occurs
- **WHEN** a voxel request fails with an error other than the documented temporary capacity response
- **THEN** existing failure accounting and retry limits continue to apply
