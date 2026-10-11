# Bottega: team mode

In the Renaissance a *bottega* was the workshop where a master worked with assistants: Leonardo trained in Verrocchio's. **Bottega** is Atelier's team mode. One computer runs Atelier (the master's bench, with the model and the project files). Other people on the same office network open it from their own browser, tablet or phone, after a one-time pairing code.

- **Off by default.** Until you switch it on, Atelier answers only on the computer it runs on.
- **LAN only.** Bottega serves your private network (home or office). It does not reach the internet. *Tailscale support is planned and coming soon* for reaching your Atelier from outside your network; it is not in this release.
- **Free**, like the rest of Atelier. Nothing is sent to ARCITECH or anyone else.

## How it works

Atelier itself keeps listening on `localhost` only. Bottega is a small gateway that runs inside Atelier and listens on this computer's private network addresses (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`), by default on port 3082. It stands in front of Atelier like a doorman:

1. A device must **pair** first, with a six-digit code that only the person at the host computer can see.
2. After pairing, the device holds a private token in its browser. Atelier's own sign-in never leaves the host computer.
3. Every request, and every live connection, is checked again. A device you **revoke** is cut off at once.

## Turn it on

You need Atelier running on the host computer.

1. Open Atelier and start a new session in a workspace folder. Under **Start from**, find the **Bottega** card.
2. Switch on **Share on my network**.
3. The card shows the address to open on the other device (for example `http://192.168.1.20:3082/`) and a pairing code.

Windows asks the first time (see [the firewall prompt](#the-windows-firewall-prompt)). Bottega remembers that you switched it on and starts again with Atelier next time; switch it off the same way. A terminal start works too:

```sh
atelier web --bottega        # installed command
pnpm start -- --bottega      # from the source code
ATELIER_BOTTEGA=1 pnpm start
```

These print the address and a first pairing code in the terminal, for that run only (the switch on the start page is what Atelier remembers). `--no-bottega` (or `ATELIER_BOTTEGA=0`) keeps it off for a run, whatever you chose before.

## Pair a device

1. On the other device, make sure it is on the same network (same Wi-Fi or cable network), then open the address from the Bottega card in its browser.
2. Enter the six-digit code. Give the device a name if you like ("Anna's phone").
3. Atelier opens. The device stays paired until you remove it, or for 30 days after it was last used.

The code is valid for **ten minutes**, works **once**, and dies after **five wrong tries**. A device that keeps guessing wrongly is also slowed down. Choose **New code** on the card for the next device. You can pair as many devices as you need.

## See and revoke devices

The Bottega card lists every paired device: its name, its address and when it was last used. **Revoke** removes one; **Revoke all** removes every device. The device is refused at its next request and its open connections close immediately. To let it back in, pair it again with a new code.

Paired devices cannot see this card or change Bottega. Only the person at the host computer can switch it off, make codes and revoke devices.

## The Windows firewall prompt

The first time Bottega listens, Windows Defender Firewall asks whether to let the **Node.js JavaScript Runtime** (Atelier's own runtime, in `%LOCALAPPDATA%\Programs\Atelier-Preview\versions\<version>\runtime`) communicate on networks.

- Tick **Private networks** (home or office). **Untick Public networks.**
- Press **Allow access**. Windows may ask for an administrator's approval here; everything else in Atelier works without one.

Good to know:

- If you pressed Cancel, or the other device cannot connect: Windows Security > Firewall & network protection > Allow an app through firewall > Change settings, find **Node.js JavaScript Runtime** (the entry for Atelier's path) and tick **Private**.
- If your Wi-Fi is set to **Public**, Windows blocks incoming connections even after you allowed them. Set it to **Private** under Settings > Network & internet > Wi-Fi > your network.
- After an Atelier update the runtime lives in a new folder, so Windows may ask once more.
- On Linux, allow the port from your network only, for example `sudo ufw allow from 192.168.0.0/16 to any port 3082 proto tcp` (use your own network range).

## What is protected, and what is not

Protected:

- Atelier on the host stays on `localhost`; Bottega is the only door, and only while it is on.
- Only private addresses are served: clients from public addresses and from Tailscale-style overlay addresses (`100.64.x.x`) are dropped before they get an answer, and Bottega never listens on a public or VPN adapter.
- Nothing but the pairing page is served without a paired device. Cross-site requests and requests for other host names (DNS rebinding) are refused.
- Pairing codes are kept in memory only, never on disk or in the log (starting from a terminal with `--bottega` prints the first code in that terminal). Devices are stored only as a hash (`devices.json` in the `atelier-bottega` folder of your Atelier home), so copying the file gives no access, and Atelier's own sign-in token is never given to a device.

Not protected, so please read:

- **Anyone you pair can use Atelier as you do.** That includes answering Atelier's approval questions ("run this command?") and reading and writing your workspace folders. Pair only people and devices you trust, on a network you trust.
- **Plain HTTP.** Traffic between a device and the host is not encrypted, as on any home or office web page without HTTPS. Use a Wi-Fi network with a proper password, and do not use Bottega on a guest or public network. Browser features that need HTTPS (for example the microphone or installing Atelier as an app) may not be available on the other device.

## Honest limits in this release

- **One workshop, no separate accounts.** All paired devices share the host's chats, settings, model and files. Two people can open the same session, but they should not work in it at the same moment.
- The host computer must be on, awake and running Atelier. If it sleeps or Atelier stops, the other devices lose the connection.
- IPv4 networks only. Everything runs on the host: its model, its tools, its speed.
- WSL: in its default (NAT) mode other devices cannot reach Atelier inside WSL. Use the Windows installer on the host computer, or turn on WSL's mirrored networking.
- Guest Wi-Fi with "client isolation" blocks devices from reaching each other; use the main network.
- No access from outside the network. Do not forward a port from your router: Bottega refuses public addresses on purpose. *Tailscale support is planned and coming soon.*

## Settings

| Variable | What it does | Default |
|---|---|---|
| `ATELIER_BOTTEGA` | `1` starts Bottega at launch, `0` keeps it off | what you chose last, else off |
| `ATELIER_BOTTEGA_PORT` | Port to listen on (the next free one is used if it is busy) | 3082 |
| `ATELIER_BOTTEGA_BIND` | Advanced: listen only on these private addresses, separated by commas, instead of every network adapter | automatic |

Your choice and the paired devices are kept in `atelier-bottega/` inside your Atelier home (`settings.json`, `devices.json`).

## Troubleshooting

- **"Waiting for a private network address"**: the computer has no home or office network address yet. Join the Wi-Fi or plug in a cable; Bottega notices by itself.
- **The other device cannot open the address**: same network? Firewall prompt answered for **Private**? Network profile **Private**? Is Atelier still running on the host? Try the host's own address from the host first.
- **"Port ... is already in use"**: set `ATELIER_BOTTEGA_PORT` to a free port.
- **"Bottega cannot sign in to Atelier on this computer"**: start Atelier with its launcher (Start menu icon, `atelier`, or `pnpm start`), not with a bare `dsh web`.
- **The code is refused**: it may have expired or been used. Choose **New code** on the host.

## For maintainers

Bottega lives in `public/atelier-start/bottega/` (Node's own modules only): `gateway.mjs` (the listener and its checks), `devices.mjs` (devices, codes, limits), `network.mjs` (which addresses and clients are allowed), `host-session.mjs` (the gateway's own sign-in), `bottega.mjs` (listeners, follows network changes), `pages.mjs` (the pairing page). The host side and the RPC channel `/atelier-bottega` are in `public/atelier-start/index.mjs`; the card is in `client.js`. The gateway never forwards that channel.

```sh
pnpm test:bottega     # pairing, expiry, revoke, guards (node --test public/atelier-start/test/*.test.mjs; no Atelier install needed)
pnpm smoke:bottega    # node scripts/bottega-smoke.mjs: a full run on test ports 39080 and 39081, on loopback only
```
