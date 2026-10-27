# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real stromleser (a three-phase and a
      single-phase meter ideally, one PIN-locked): test button, device
      creation, the consumption the core derives from the index.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Run the store validator (`npx github:GladysAssistant/integration-store .`):
      the development agent could not run it.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real reader (built without one)

- [ ] The answer of `/v1/data` as the library's fixtures show it: units of
      the registers (Wh on one fixture, kWh on another), a firmware sending
      values without unit (the library logs it: energies without unit are
      not used here, powers without unit are read in W).
- [ ] The sign of 16.7.0 when injecting (negative on the meters we know).
- [ ] `timestamp`: the time of the last SML frame read (used to tell a frozen
      reading after 5 minutes)? Does it move when the meter sends nothing?
- [ ] The PIN-locked meter: no 16.7.0 at all, or 16.7.0 at 0?

## Decisions

- **SDK `^0.16.0`** (2026-10-27, migration wave 4): 0.16.0 is on npm since
  2026-10-25 (a stale npm cache said otherwise); it adds the ai, tts and music
  types; no effect here (`poll_frequency` unused). `keywords`, `countries`
  and `gladys_version >= 5.3.0` wait until Gladys 5.3 is widespread.
- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-energieleser:0.1.0`),
  as for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **Reused project**: energieleser.py (nineti GmbH, the maker, MIT, 0.1.7,
  `main` at commit 21bab4c), cloned read-only in `_ref/energieleser`, ported to
  JavaScript (`src/energieleser/`): the page, the type prefixes, the OBIS
  codes, the 0 of a cumulative register, the 16.7 alias, PIN-locked. The SDK
  stays the only runtime dependency. The guard (`src/guard.js`, the approved
  file of gladys-zeversolar / gladys-imeon, `maxKw` as a parameter), the store,
  the address parser and the pace come from gladys-zeversolar /
  gladys-p1-monitor (approved). The template's demo files were removed with
  `git rm`.
- **Scope (v1)**: the stromleser only (the module of lot 14 is the
  electricity meter). Gas, water and heat readers are recognized by their
  prefix and refused with their name (red status, retries doubled to
  5 minutes). Gas and water would be plain volume sensors, never in the
  energy monitoring (rule of wave 3).
- **Read-only**: the reader takes no command; the library's firmware check
  (a cloud server of the maker) is not ported.
- **External id**: `energieleser:<device_id>` (the id of every answer, upper
  case, checked `^[A-Z][A-Z0-9_]{2,63}$`, as the library's `unique_id`), one
  reader per integration; the address is only a param. Every read carries its
  own identity: another reader at the address (DHCP swap) gets its own device,
  never writes into the old one, and the status says so. An answer without a
  readable id is a wrong answer (red), never "another reader". The id and the
  features seen are kept in `/data`, so the device is offered at a restart
  before the first read.
- **Energy index (lot 6 rules)**: 1.8.0 converted to kWh from the unit of the
  reader (Wh, kWh, MWh; no unit: not used, never guessed), rounded to 3
  decimals, passes `IndexGuard` (50 kW, 0.5 kWh slack: 63 A x 3 phases is
  about 43 kW) once a minute; held values are sent as the last accepted one,
  the guard is kept in `/data` before Gladys gets the value. A drop is
  accepted by the button (a real meter can be replaced), as in
  gladys-p1-monitor. The tariff registers and the injection are plain
  sensors (never an index, never `energy`), never 0. No
  `publishEnergyConsumption` (tested).
- **Power**: 16.7.0 is the net power, signed (negative when injecting): the
  only energy-sensor power, min -100 kW. 1.7.0, 2.7.0, 15.7.0 and the phases
  are plain sensors (the phases without history). A power without unit is read
  in W.
- **Frozen reading (review 1, I1)**: the last `timestamp` of the reader and
  the wall time it changed are kept in `/data` (`fresh`). After a restart, a
  reading with that same timestamp keeps its age (stale after 5 min: no power
  sent); any other first timestamp is not trusted until it moves (about 10 s):
  a power frozen before a restart is never published as new. Without a
  `timestamp` (the library requires it), the power is published and the
  status says a frozen reading cannot be told. A 1.8.0 sent but unusable (no
  known unit) is told in the status, even before the index feature exists.
  The "another reader" note ends as soon as the reader answering has its
  created device.
- **Features**: what the reader showed, merged with the features of the
  created device: the set only grows, a device published again never loses a
  feature.
- **Pace (lot 11 lessons)**: one timer, one read at a time, never two reads
  less than 10 s apart (Home Assistant polls every 10 s) whatever asks: a
  reconnection, a save, the Discover tab, a device created, the accept button
  only wait for the next read; the test button makes the read only when one is
  due, otherwise tells the last one; the time of the last read is written in
  `/data` before the request (at most once a minute). A reconnection during a
  read does not start another one.
- **Late answers (lot 11)**: a read belongs to the session of its address; a
  late answer of an old address publishes nothing and sets no status (checked
  after every await, tested).
- **Errors**: unreachable or wrong answer: retries 10 s doubled to 5 min (in
  memory). 429/5xx: pause in `/data` from Retry-After or 1 min doubled,
  bounded 1 min to 6 h; a reconnection keeps it, another address ends it.
- **Hostile answers**: 16 KiB read into one buffer allocated once, 10 s for
  the whole answer, no redirect followed, 128 fields at most, every value
  against a strict pattern and bounds, only own keys read (no prototype
  pollution, tested), nothing read as 0 by default.
- **Secrets**: none (the local API has no login). Logs and statuses use our
  own codes only, never a text of the reader.
- **States**: `publishChangedStates` with a 10-minute heartbeat: at most
  about 9 live states every 10 s and 11 indexes a minute (about 65 a minute),
  far below the 300 states a minute of Gladys. No scene event.
- **Every connection** publishes the status and the Discovery list again and
  forgets the published states.
- **No custom User-Agent**, no imitation: Node's own fetch, one GET.
- **Gladys version**: `>=5.2.0`, like the other energy integrations.

## Ideas

- gasleser and wasserleser as volume sensors (m³, never in the energy
  monitoring), wärmeleser as plain sensors.
- Several readers in one integration (a list of addresses).
- mDNS discovery (`_stromleser._tcp`) through the core's network discovery.
