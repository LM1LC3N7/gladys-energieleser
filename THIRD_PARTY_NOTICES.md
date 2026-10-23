# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## energieleser (nineti-GmbH/energieleser.py)

<https://github.com/nineti-GmbH/energieleser.py>, by nineti GmbH, the maker of
the energieleser readers, the library the energieleser integration of Home
Assistant uses. Version 0.1.7 (`main` at commit 21bab4c, 2026-09-25).

Ported to JavaScript in `src/energieleser/client.js` and
`src/energieleser/model.js`: the local API of the reader (`GET /v1/data`, one
JSON object, a 10-second timeout), the reader types by `device_id` prefix
matched longest first (`STROM`, `GAS`, `GAS_PULSE`, `WASSER`, `HEAT`), the
OBIS codes of the stromleser (`1.8.0` to `1.8.4`, `2.8.0` to `2.8.4`,
`16.7.0` with its `16.7` alias, `15.7.0`, `1.7.0`, `2.7.0`, `36.7.0`, `56.7.0`,
`76.7.0`) as "value unit" strings, a cumulative register at 0 read as absent,
the meter without active power read as PIN-locked, and `rssi` in dBm. The
test answers in `test/fixtures/energieleser.js` are shaped after its test
fixtures. Changed here: an energy without a known unit is never used, values
are read against strict patterns and bounds, and only the stromleser is read
(the other readers are recognized and refused). The firmware check of the
library (a server of the maker) is not ported.

Its license, reproduced as it appears in the repository:

```
MIT License

Copyright (c) 2026 nineti GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-p1-monitor, gladys-zeversolar

The plausibility guard of the billed index (`src/guard.js`), the `/data`
store (`src/store.js`), the address parser (`src/config.js`) and the pace of
the reads come from the sibling integrations
[gladys-p1-monitor](https://github.com/LM1LC3N7/gladys-p1-monitor) and
[gladys-zeversolar](https://github.com/LM1LC3N7/gladys-zeversolar), same
project, Apache-2.0.
