# gladys-energieleser

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the
**energieleser stromleser**, the optical reader of German electricity meters
(nineti GmbH), read through its local API (`GET http://<address>/v1/data`), no
cloud. Not affiliated with energieleser.

**Never tested with a real energieleser reader**: built from the maker's
Python library [energieleser.py](https://github.com/nineti-GmbH/energieleser.py)
(MIT, the one Home Assistant uses), ported to JavaScript.

- Net power (16.7.0) every 10 s, as the energy-sensor power.
- Consumption index (1.8.0) once a minute, as the only energy index of the
  Gladys energy monitoring, checked by a guard: never 0, a drop or a jump held
  until the user accepts it.
- Tariff indexes, injection (2.8.x), import/export/absolute powers, the power
  per phase and the Wi-Fi signal as plain sensors (the injection is never
  billed).
- Read-only. One reader per integration; only the stromleser for now.

User guides: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm install
npm run format:check
npm run lint
npm test
npm run audit
npm run cover        # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .
```

Architecture and rules: [CLAUDE.md](CLAUDE.md). Decisions and open points:
[TODO.md](TODO.md). Releases: Actions → Release (see
[CHANGELOG.md](CHANGELOG.md)).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the ported logic of energieleser.py is
under MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
