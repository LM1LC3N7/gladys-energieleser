# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-23

### Added

- First version: an energieleser stromleser read through its local API
  (`/v1/data`) every 10 seconds, one device per reader keyed by its id.
- Net power as the energy-sensor power; the consumption index (1.8.0) as the
  only energy index, published once a minute and checked by a guard (never 0,
  a drop or a jump held until "Accept the held index", kept in `/data`).
- Tariff indexes, injection, import/export/absolute power, power per phase
  and Wi-Fi signal as plain sensors (the injection is never billed).
- Status notes: PIN-locked meter, frozen reading, another reader at the
  address, index held back; other energieleser readers refused by name.
- A reading frozen before a restart is never published as new: the last
  timestamp of the reader and the time it changed are kept in `/data`; a
  reading without timestamp and a 1.8.0 without known unit are told in the
  status.
- Test button that never reads faster than the 10-second pace; pace and
  429/5xx pauses kept across restarts.

[Unreleased]: https://github.com/LM1LC3N7/gladys-energieleser/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-energieleser/releases/tag/v0.1.1
