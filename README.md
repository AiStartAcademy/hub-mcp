# hub-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude Code, Claude
Desktop, or any MCP client) operate an academy **[hub](https://github.com/AiStartAcademy/hub)** — the open-source LMS, lead engine and
content platform. Through it an assistant can stand up cohorts, edit courses and lessons, work
leads, author drip email, manage memberships and run venue events, with the same rules the hub's
admin UI enforces.

It is a thin, stdio-only adapter. Every read and write goes to the hub's authenticated internal
API (`/api/internal/mcp/v1/*`); no business logic lives here and nothing touches the hub's
database directly.

## Install

Requires Node.js 18 or newer to run, and [bun](https://bun.sh) to build. Build it once from source:

```bash
git clone https://github.com/AiStartAcademy/hub-mcp.git
cd hub-mcp
bun install
bun run build      # writes dist/index.js
```

MCP clients then launch `node /absolute/path/to/hub-mcp/dist/index.js`. An npm package
(`npx -y @aistartacademy/hub-mcp`) is coming; the examples below will switch to it then.

The server speaks JSON-RPC over stdin/stdout and logs only to stderr, so you would not normally
run it by hand.

## Configure

| Variable | Required | Meaning |
|---|---|---|
| `HUB_BASE_URL` | yes | Base URL of your hub, no trailing slash, e.g. `https://hub.example.com`. URLs containing `localhost` or `127.0.0.1` are labelled `LOCAL`, everything else `PROD`; the label is stamped on every preview and result. |
| `HUB_MCP_TOKEN` | yes | Bearer token for the hub's MCP API. Must equal the hub's own `HUB_MCP_TOKEN`. |
| `HUB_MCP_READONLY` | no | `true` makes every write tool refuse at the commit step. Anything else, or unset, leaves writes enabled (still subject to the hub-side switch below). |
| `HUB_DEFAULT_TIMEZONE` | no | IANA timezone used when a tool call omits one (session series, venue events). Defaults to `America/Los_Angeles`, the hub's own default. Validated at startup. |

The server checks its configuration on launch and exits with a clear message if something is
missing or invalid, instead of failing on the first tool call.

### Claude Code

```bash
claude mcp add hub \
  -e HUB_BASE_URL=https://hub.example.com \
  -e HUB_MCP_TOKEN=your-token \
  -- node /absolute/path/to/hub-mcp/dist/index.js
```

or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "hub": {
      "command": "node",
      "args": ["/absolute/path/to/hub-mcp/dist/index.js"],
      "env": {
        "HUB_BASE_URL": "https://hub.example.com",
        "HUB_MCP_TOKEN": "${HUB_MCP_TOKEN}",
        "HUB_MCP_READONLY": "true"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "hub": {
      "command": "node",
      "args": ["/absolute/path/to/hub-mcp/dist/index.js"],
      "env": {
        "HUB_BASE_URL": "https://hub.example.com",
        "HUB_MCP_TOKEN": "your-token"
      }
    }
  }
}
```

A common setup is two entries pointing at the same build: one for a local or staging hub
with writes on, and one for production with `HUB_MCP_READONLY=true` until you need it.

## Set up the hub side

The token and the authoritative write switch both live on the hub.

1. **Mint a token.** Generate a long random value dedicated to this server, for example
   `openssl rand -hex 32`. Do not reuse any other service token.
2. **Give it to the hub** as `HUB_MCP_TOKEN`, either in the hub's environment or, if your hub
   has the admin **Settings → Integrations** store, there (the stored value wins over the
   environment and can be rotated without a redeploy). If the hub has no token configured,
   every MCP route fails closed.
3. **Decide on writes.** The hub only accepts MCP writes when its own `HUB_MCP_WRITES_ENABLED`
   is exactly `true`. Missing or any other value returns 403 on every write while reads keep
   working.
4. **Give the same token to this server** as `HUB_MCP_TOKEN` (see Configure). Keep it in your
   MCP client's secret store or environment, never in a committed file.

To rotate, set a new value on the hub, then update the client. To cut off the server entirely,
unset or change the hub's token.

## How writes work

Every tool that changes data is a **two-step write**:

1. The first call is a dry run (`dryRun` defaults to `true`). It validates the request, shows
   exactly what would change, and returns a `previewId`. It writes nothing.
2. A second call with `previewId` and `confirm: true` commits. It sends **the stored preview**,
   not whatever arguments come with the confirm call, so a model cannot change the payload
   between preview and commit.

Previews are single-use and expire after 10 minutes. For tools that email or text people
(`broadcast_send`, `certificate_notify`, `instructor_outreach`), the preview renders the real
message and recipient list; that render is the human approval, so read it.

A few one-step actions skip the preview because they change nothing a student sees:
`media_upload`, `program_cover_generate` (costs money per call), `lesson_audio_extract`, and the
`sync`/`nudge`/`gcal_sync` actions of the instructor tools. They are still refused under
`HUB_MCP_READONLY=true` and by the hub-side switch.

One default to know about: `venue_event_create` creates events as `APPROVED` unless told
otherwise, and committing an `APPROVED` event emails the organizer a confirmation. Pass
`status: "PENDING"` when the booking is not yet agreed. Sending an agreement or a payment link reaches a real organizer, and there is no void
endpoint.

Other guarantees: new cohorts are always created as `DRAFT`; there are no hard-delete tools
(archive through status fields instead; `zoom_meeting_delete` removes a Zoom meeting, not a hub
record); and a hub that cannot be reached is reported as an error, never as success.

## Read-only kill switches

There are two, and they are independent:

- **`HUB_MCP_READONLY=true`** on this server refuses every commit locally. It is a convenience:
  anyone holding the token can bypass it by calling the hub directly.
- **`HUB_MCP_WRITES_ENABLED`** on the hub is the authoritative switch. Unless it is exactly
  `true`, the hub rejects every write no matter which client sends it.

Run production read-only by default and enable writes deliberately.

## Tools

Generated from the tools the server registers (`bun run docs:tools`).

<!-- tools:start -->
40 tools.

### Cohorts & sessions

| Tool | What it does |
|---|---|
| `cohort_create` | Create a cohort in the hub. |
| `zoom_meeting_delete` | Delete a real Zoom meeting created by cohort_create (createZoomMeeting: true) — cleanup for test/throwaway cohorts. |
| `cohort_instructor_status` | Read-only rollup of instructor participation for published/upcoming cohorts: PENDING/CONFIRMED/DECLINED per instructor, per-session availability, notes, and outreach history. |
| `cohort_update` | Update fields on an existing cohort in the hub (title, description, delivery mode, location, dates/times, timezone, instructor set, linked courses). |
| `session_series_list` | List shared check-in/onboarding series, or fetch one by id with its instructor, cohort attachments, and upcoming occurrences. |
| `session_series_create` | Create a shared check-in or onboarding session series in the hub. |
| `session_series_attach` | Replace the cohorts served by one shared session series. |
| `cohort_roster` | List a cohort roster with name, email, membership tier, and enrollment source. |

### Instructors

| Tool | What it does |
|---|---|
| `instructor_schedule` | Per-session instructor scheduling: see pending change requests, read one instructor's full cross-cohort schedule, propose sessions for a cohort, accept/counter/confirm a change request, or re-push confirmed sessions to Google Calendar. |
| `instructor_outreach` | Instructor participation workflow: sync roster records, send a confirm-your-participation email cycle, or nudge non-responders. |
| `instructor_list` | List instructors from the hub with optional paging and filters. |
| `instructor_get` | Fetch a single instructor profile by id or slug. |
| `instructor_profile_update` | Update allowlisted instructor profile fields in the hub. |

### Courses, lessons & media

| Tool | What it does |
|---|---|
| `lesson_list_unenriched` | List raw Zoom-synced lessons in the hub that still have no content (empty tags) — the 'Recording - M/D/YYYY' placeholders syncRecordingsToProgram() creates with no title/description/keywords. |
| `lesson_content_update` | Fill intro/text/tags/timecodes/name/posterUrl/audioUrl/captionsUrl/quizQuestions onto EXISTING raw lessons in the hub — no new schema, just the columns syncRecordingsToProgram() already created empty. |
| `lesson_audio_extract` | Trigger asynchronous audio extraction for an existing lesson on the hub. |
| `program_update` | Edit an EXISTING course (Program) in the hub: name, description, cover, accessMode, status. |
| `program_cover_generate` | Generate a course cover image via the hub's own gpt-image-1.5 pipeline — same model, size, and GCS destination as the admin UI's 'Generate Cover' button, so results are visually consistent with every existing course cover on the site. |
| `media_upload` | Upload a local file into the hub's media library — GCS object + Media row, the same destination as the admin UI's upload button, so it appears in /media like any other file. |

### Leads (CRM)

| Tool | What it does |
|---|---|
| `lead_list` | List leads (contacts) in the hub CRM: status, source, tags, last activity. |
| `lead_get` | Fetch one lead by id with full detail: contact fields, attribution, notes, and up to 100 recent events (quiz submissions, asset downloads, lesson views). |
| `lead_facets` | Aggregate pipeline view of leads: status counts, sources, and tags EXCLUDE contacts flagged excludeFromPipeline. |
| `lead_update` | Batch-update 1-50 CRM contacts, especially to flag non-customers (test accounts, staff, instructors, partners, or duplicates) out of pipeline reporting. |

### Email & messaging

| Tool | What it does |
|---|---|
| `drip_campaign_list` | List drip campaigns (lead-nurture sequences) in the hub with their status, audience summary, step count, enrollment counts and send totals. |
| `drip_campaign_get` | Fetch one drip campaign by id or slug: settings, audience rules, exit statuses, and the full step sequence with cumulative timing. |
| `drip_audience_preview` | Count how many leads currently match a set of drip audience rules, without creating or changing anything. |
| `drip_campaign_upsert` | Create or edit a drip campaign (lead-nurture email sequence) in the hub. |
| `broadcast_send` | Send one drip campaign immediately to its current audience. |
| `certificate_notify` | Email/SMS cohort graduates their completion certificates. |

### Memberships

| Tool | What it does |
|---|---|
| `membership_list` | List hub memberships (paid + complimentary). |
| `membership_grant` | Grant a COMPLIMENTARY membership (promotion, partner, scholarship) by email. |
| `membership_revoke` | Revoke a COMPLIMENTARY membership (find its id with membership_list, compOnly: true). |

### Venue events

| Tool | What it does |
|---|---|
| `venue_event_list` | List venue events from the hub with optional status/date/search filters, or fetch one event by id or slug for full detail. |
| `venue_event_registrations` | Fetch registrations for one venue event by id or slug: attendee identity, registration status, waiver state, and createdAt. |
| `venue_event_create` | Create a venue event in the hub. |
| `venue_event_update` | Update one venue event in the hub by id or slug. |
| `venue_event_set_status` | Set one venue event status in the hub by id or slug. |
| `venue_agreement_create` | Create a venue agreement for one venue event in the hub. |
| `venue_rental_payment_create` | Issue a Stripe payment link for one venue rental (PAID_RENTAL deal) in the hub. |
| `venue_rental_payment_deactivate` | Deactivate the unpaid Stripe rental payment link for one venue event in the hub. |
<!-- tools:end -->

## Security notes

This server acts with the hub owner's authority, and the caller is a language model. Treat it
accordingly.

- **Dedicated credential.** `HUB_MCP_TOKEN` is used for nothing else. Rotate and revoke it
  independently, and never paste it into a tool argument or a prompt.
- **Configuration is not user input.** `HUB_BASE_URL` and the token come only from the
  environment and are read once at startup.
- **Hub content is untrusted.** Lead notes, lesson text and email bodies returned by tools can
  contain prompt-injection attempts. They are data, not instructions.
- **Reads can contain personal data.** Lead, roster and registration tools return names,
  emails and attendance. Tool output is visible to your model provider and may be logged by
  your MCP client; scope who can use a server pointed at production.
- **stdout is the protocol.** All diagnostics go to stderr; never add logging to stdout.
- **Local trust.** Stdio keeps the server off the network, but it does not sandbox the process.
  Anyone who can run commands as your OS user can read the token from its environment.
- **No HTTP transport.** Only stdio is supported. Exposing it over HTTP needs proper OAuth,
  origin checks and per-user tokens, which this release does not provide.

Report vulnerabilities privately via GitHub security advisories on this repository rather than
in a public issue.

## Compatibility

Built against the public hub v1 MCP API. Notes for this release:

- `cohort_create` and `zoom_meeting_delete` call the hub's pre-v1 routes
  `/api/internal/mcp/cohort` and `/api/internal/mcp/cohort/zoom`; all other tools use
  `/api/internal/mcp/v1/*`.
- `session_series_create` accepts an optional `location` for hybrid calls. Hubs that predate
  session-series locations accept the request and ignore the field.

## Develop

```bash
bun install
bun run typecheck
bun test
bun run build                 # → dist/index.js, runs under plain Node 18+
bun run dev                   # run from source over stdio
bun run docs:tools            # regenerate the tool table above from dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
