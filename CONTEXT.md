# Web Graffiti

Web Graffiti is a shared creative layer that lets people place visual marks over eligible public websites and see marks left there by other people.

## Language

**Graffiti**:
A visual mark created over an eligible website and shown live to other Web Graffiti users visiting the exact same URL.
_Avoid_: Annotation, private doodle

**Page Surface**:
The shared Creative Layer associated with one exact website URL.
_Avoid_: Domain wall, site-wide canvas

**Content Anchor**:
The specific website element that graffiti is positioned relative to so that it follows that content across desktop layouts.
_Avoid_: Fixed screen coordinate, viewport position

**Orphaned Graffiti**:
Graffiti whose Content Anchor is temporarily absent from the current page. It remains stored but hidden until its anchor returns.
_Avoid_: Floating graffiti, fallback-position graffiti

**Anonymous Creator**:
A device-bound private identity that owns graffiti without exposing an account or providing recovery on another device.
_Avoid_: Account, guest account

**Graffiti Mode**:
The explicit state in which drawing controls are available and the underlying website cannot receive pointer interactions.
_Avoid_: Edit mode, paint mode

**Creative Layer**:
The shared visual surface placed over a website, containing the visitor's graffiti together with graffiti from other users.
_Avoid_: Private overlay, annotation layer

**Palette**:
The bottom control bar revealed when Graffiti Mode begins, providing quick colors and drawing tools.
_Avoid_: Permanent toolbar, menu

**Spray**:
The only tool that creates graffiti, depositing fixed-color particles at a fixed rate with continuous thickness as its only adjustable property. Slow or repeated passes naturally build coverage.
_Avoid_: Brush, marker, pen

**Eraser**:
A continuously resizable tool that partially removes only graffiti owned by the Anonymous Creator, regardless of when it was created.
_Avoid_: Delete tool, clear-all tool

**Custom Color**:
A Spray color chosen through a visual saturation/brightness field, hue strip, HEX input, or RGB inputs, without HSL, HSB, alpha, or opacity controls.
_Avoid_: Transparent color, HSL color

**Close Graffiti Mode**:
The explicit action that returns the website to normal interaction while leaving graffiti visible and non-interactive.
_Avoid_: Done, publish, submit

**Blocklist**:
The maintained list of websites where the Creative Layer and Graffiti Mode are unavailable.
_Avoid_: Allowlist, protected mode

**Sensitive Page**:
A page where Web Graffiti is automatically unavailable because its content or purpose may expose private, authentication, payment, or similarly sensitive information, whether or not its website is on the Blocklist.
_Avoid_: Blocklisted website

**Safety Scan**:
Repeated automated analysis of live graffiti after it has become visible, used to detect and remove unsafe content.
_Avoid_: Pre-approval, safety buffer
