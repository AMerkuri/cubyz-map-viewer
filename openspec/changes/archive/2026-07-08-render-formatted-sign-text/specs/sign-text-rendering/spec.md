## MODIFIED Requirements

### Requirement: On-face text rendering

The client SHALL render each sign's text as a single texture-mapped quad placed coplanar with the sign's front face, using the world-space text-plane corners provided in the sign record. The text texture SHALL be produced on a canvas mirroring the in-game layout: a 128x72 pixel canvas with a 4px margin (120x64 usable area), transparent background, the Unscii-16 font at native pixel size, and no drop shadow.

Before layout and drawing, the client SHALL interpret the sign record's `text` as Cubyz formatted source text using `TextBuffer.Parser` semantics: `*` toggles italic, `**` toggles bold, `__` toggles underline, `~~` toggles strikethrough, `\` escapes the next codepoint, `#` consumes six following hexadecimal color digits to set the current color, and `§` resets bold/italic/underline/strikethrough while preserving the current color. Formatting controls SHALL NOT render as visible glyphs when sign text is drawn.

Text layout SHALL match the game: each visible line horizontally centered within the usable width, lines stacked top-down at 16px line height, explicit `\n` producing hard line breaks, automatic word-wrapping at the usable width, and a hard mid-word break when a single visible word exceeds the usable width. Text exceeding the usable height SHALL be clipped. Wrapping and centering SHALL use visible text only; formatting controls SHALL NOT consume measured width.

The text quad SHALL be offset slightly toward the viewer relative to the sign board to avoid z-fighting, and SHALL respect terrain occlusion so signs hide behind intervening geometry.

#### Scenario: Single-line sign

- **WHEN** a sign record has single-line text
- **THEN** the client SHALL render that text centered on the sign face, oriented and tilted with the sign

#### Scenario: Multi-line sign

- **WHEN** a sign record's text contains newlines or wraps at the usable width
- **THEN** the client SHALL render multiple centered lines stacked at 16px line height within the sign face

#### Scenario: Colored sign text

- **WHEN** a sign record's text is `#ff0000EVIL#000000SNALE#ffffff was here`
- **THEN** the client SHALL render visible text `EVILSNALE was here` with `EVIL` red, `SNALE` black, and ` was here` white, without rendering the color control sequences

#### Scenario: Markdown-like sign effects

- **WHEN** a sign record's text contains Cubyz controls for bold, italic, underline, or strikethrough
- **THEN** the client SHALL render the affected visible text with the corresponding style and SHALL NOT render the control markers

#### Scenario: Escaped control character

- **WHEN** a sign record's text escapes a formatting marker with `\`
- **THEN** the client SHALL render the escaped marker as visible text using the current style

#### Scenario: Occlusion behind terrain

- **WHEN** terrain geometry is between the camera and a sign
- **THEN** the sign text SHALL be occluded by that geometry rather than drawn on top
