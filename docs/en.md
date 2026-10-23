# energieleser

Unofficial integration, not affiliated with energieleser (nineti GmbH). It
reads a **stromleser**, the energieleser optical reader clipped on the
infrared port of a German electricity meter, through its local API: no cloud,
no account, nothing sent to the reader but one read every 10 seconds.

**Never tested with a real energieleser reader**: it was built from the
maker's own Python library (the one Home Assistant uses). Feedback welcome.

## What you get

One device per reader, named after its id (`stromleser STROM_ONE_…`), with the
values the meter gives (a meter sends a subset of them):

| Feature                                | Kind                     | Meter code             |
| -------------------------------------- | ------------------------ | ---------------------- |
| Net power (negative when injecting)    | energy sensor, W         | 16.7.0                 |
| Consumption index                      | energy index, kWh        | 1.8.0                  |
| Consumption index, tariff 1 to 4 (kWh) | plain sensor             | 1.8.1 to 1.8.4         |
| Injection index (kWh), tariffs 1 to 4  | plain sensor             | 2.8.0 to 2.8.4         |
| Power taken, injected, absolute (W)    | plain sensor             | 1.7.0, 2.7.0, 15.7.0   |
| Power L1, L2, L3 (W)                   | plain sensor, no history | 36.7.0, 56.7.0, 76.7.0 |
| Wi-Fi signal (dBm)                     | plain sensor, no history | rssi                   |

- The **consumption index** feeds the Gladys energy monitoring: Gladys
  derives the consumption and its cost from it. It is published once a minute
  and checked first: never 0; a drop or a jump that the home could not have
  drawn is **held back** (the last accepted value is sent again) and shown in
  the integration status. If it is right (a new meter, a long outage), click
  **Accept the held index**: exactly the value shown is taken. Saving the
  configuration never accepts it.
- The **injection** is never in the energy monitoring (it would be billed as
  consumption): plain sensors.
- The powers are sent every 10 seconds, only when they change (and every
  10 minutes otherwise). When the reader gives no new reading for 5 minutes
  (optical head moved), they are no longer sent and the status says so.

## Setup

1. Install the energieleser app, put the stromleser on your meter and connect
   it to your Wi-Fi, as the maker explains.
2. Find its IP address (in your router or the app) and preferably give it a
   fixed address in your router.
3. In Gladys, open the integration, enter this address, save.
4. In the **Discover** tab, create the device.

If the status says the meter gives no power, the meter is probably
PIN-locked: enter on the meter the PIN given by your grid operator to unlock
its extended data. The indexes go on in the meantime.

## Buttons

- **Test the connection**: reads the reader when a read is due (never more
  than one every 10 seconds), otherwise tells the last read.
- **Accept the held index**: see above.

## Limits

- Only the **stromleser** (electricity) is read. A gasleser, wasserleser or
  wärmeleser at the address is recognized and refused, with its name.
- One reader per integration. Another reader answering at the address (a
  changed IP) gets its own device: its values never go to the previous one.
- A meter index without a known unit (Wh, kWh, MWh) is never used.
- Read-only: the reader takes no command.

## Troubleshooting

The status of the integration says what happens: address missing, reader
unreachable (a new try after 10 s, doubled up to 5 minutes), wrong answer,
index held back. To look at the reader yourself, open
`http://<address>/v1/data` in a browser on the same network.
