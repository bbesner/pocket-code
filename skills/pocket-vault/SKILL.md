---
name: pocket-vault
description: Use credentials from Pocket Code's Vault without ever seeing them. Use when a task needs an API key, token, password, login or other credential to run a command or call a service; when the user mentions a secret, asks you to "store this key", "save the password", "use the Zoho token" or asks "what credentials do we have"; and when you meet something that looks like a secret (a key, token, password or private key) in a message, a file or a tool result. The Vault runs your command with the value in its environment and hands back output with the value replaced.
---

# Pocket Code Vault

Pocket Code keeps a **Vault** on its own server: API keys, tokens, logins and secure notes,
encrypted, each under a short name such as `zoho-books` or `stripe-live`. You never see a
value. You name the secret, and Pocket runs your command with the value in the command's
environment, then gives you the output with every value replaced by `{{vault:name}}`. The
owner adds, views and copies values in the Vault view in Pocket Code, approves which commands
may use them, and sees every use. You work with the Vault through the `pocket-vault` command.

<!-- pocket:commands -->
Run `pocket-vault` from the Pocket Code directory (`node scripts/pocket-vault.mjs`, or
`npx pocket-vault`). The session instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->

## The one rule

**You never see a secret value, and you never put one anywhere.** Refer to a secret by its
name and use it with `pocket-vault run`. Never print, echo, `cat`, log or decode a value;
never write one to a file, a commit, a message, a task, a project note or a memory; never pass
one as a command-line argument. There is no command that gives you a value, and you should
not look for another way to get one (reading `.env`, the store file or another process).

**Never ask the user to paste a secret into the chat.** Anything typed into the conversation
goes to the model provider and into the transcript. Point them to the Vault instead: **Add
item** in the Vault view, or **Store in the Vault** in the composer's attach sheet or the
session's options, which keeps the value out of the message.

A `{{vault:name}}` placeholder in a message from the user is them handing you a stored secret
by name. Use that name with `run`.

## Kinds and fields

| Kind | Fields | In `--env` |
|---|---|---|
| `api_key` | `value` | `name` (means `name.value`) |
| `token` | `value` | `name` (means `name.value`) |
| `login` | `username`, `password` | `name.username`, `name.password`: always name the field |
| `credentials` | none fixed; custom fields only | `name.client_id`, `name.client_secret`: always name the field |
| `note` | `text` | `name.text` |

Any item can carry **custom fields** beside its kind's fixed ones (for example a login with a
`signature_key`). Field names are lowercase letters, digits and underscores. `show <name>` lists
every field; when an item has more than one, always write `name.field`.

## Running a command with a secret

```bash
pocket-vault run --env VAR=name[.field] [--env VAR2=name2.field] [--cwd dir] [--timeout s] -- <command…>
```

Pocket's server starts the command itself, with each `VAR` set in its environment, and
streams back its output with every value (and its base64 and URL-encoded forms) replaced by
`{{vault:name}}`. The exit status is the command's own. Output is capped at 1 MB; the command
is stopped after 10 minutes unless you pass `--timeout` (seconds).

The value is only ever in the **child's environment**. Write the command so it reads the
variable itself:

```bash
# Node or Python reading process.env / os.environ
pocket-vault run --env ZOHO_TOKEN=zoho-books -- node sync-invoices.mjs
pocket-vault run --env STRIPE_KEY=stripe-live -- python3 monthly_report.py

# A login: two fields, two variables
pocket-vault run --env PORTAL_USER=vendor-portal.username --env PORTAL_PASS=vendor-portal.password \
  -- python3 fetch_statements.py

# curl with a header: run it through a shell so the child expands the variable
pocket-vault run --env TOKEN=zoho-books -- sh -c 'curl -sS -H "Authorization: Bearer $TOKEN" https://www.zohoapis.com/books/v3/invoices'

# Tools that read a credential from an environment variable
pocket-vault run --env GH_TOKEN=github-ci -- gh api user
pocket-vault run --env GOOGLE_WORKSPACE_CLI_TOKEN=gws-token -- gws drive files list

# An SSH key: the child writes it to a private temp file, uses it, and removes it
pocket-vault run --env SSH_KEY=deploy-key.text -- sh -c 'umask 077; f=$(mktemp); printf "%s\n" "$SSH_KEY" > "$f"; ssh -i "$f" -o IdentitiesOnly=yes deploy@example.com uptime; s=$?; rm -f "$f"; exit $s'
```

- **Single-quote the `sh -c` script.** `$TOKEN` must reach the child as text and be expanded
  there. In double quotes your own shell would expand it first, to nothing, since the
  variable is not in your environment.
- **Never put a value in the arguments**, even one you think you know. Arguments show up in
  process lists, approvals and the record of use.
- **Keep commands stable.** An approved command is saved as an exact match (the program, its
  arguments and the working directory); a changed argument is a new command and asks the
  owner again. Put what varies in a script or a file the command reads.
- **The command runs with the server's permissions**, outside your own sandbox, and can do
  whatever the credential allows. Run only what the task needs.
- `{{vault:name}}` in the output means the command printed the value. Do not try to recover
  it; if the output was meant to contain it, tell the user.

## Pending, refused and off

Each item has a policy the owner sets:

- **ask** (the default): a command the owner has approved before runs at once. A new one
  waits for the owner, who gets a "Vault request" on their devices and answers *Allow once*,
  *Always allow* or *Deny*. `run` waits up to 90 seconds; if there is no answer yet it prints
  `pending <request id>` and exits with code 4.
- **auto**: any command runs, and is recorded.
- **owner**: agents cannot use the item. `run` fails and says to ask the owner.

**On `pending`:** tell the user in one line that the command is waiting for their approval in
the Vault (naming the item and the command), then run `pocket-vault wait <request id>` to
continue. `wait` runs the command once it is allowed, or reports the denial. If it prints
`pending` again, the owner has not answered; do not loop on it. A request expires after 15
minutes.

**On a refusal** (denied, an `owner` item, an expired request): say so plainly and stop. Do
not try another command, another item, a copy of the value from somewhere else, or any other
way around it. Ask the owner what they want.

**Codex in Review mode** runs in a read-only sandbox that cannot reach Pocket's server, so
`pocket-vault run` fails there. Tell the user the command needs Full access for that turn.

## Storing a secret you meet

When you come across a secret (the user pastes one, or you find one in a file, a config or a
tool result), store it **at once**, use its name from then on, and tell the user it was seen:

```bash
pocket-vault put stripe-live --kind api_key --from-env STRIPE_SECRET_KEY
pocket-vault put vendor-portal --kind login --from-file /tmp/creds.json --map username=user,password=pass
printf '%s' '{"client_id":"…","client_secret":"…"}' | pocket-vault put ups-api --kind credentials --stdin   # several named fields at once
printf '%s' "$TWILIO_AUTH" | pocket-vault put twilio-auth --kind token --stdin \
  --url https://console.twilio.com --tags twilio,sms
```

- **Name:** lowercase letters, digits and dashes, up to 64 characters, saying what it is:
  `zoho-books`, `stripe-live`, `vendor-portal`.
- **The value never goes on the command line.** Take it from an environment variable
  (`--from-env`), a file (`--from-file`, with `--map field=key,…` to pick fields out of a JSON
  file) or standard input (`--stdin`). A JSON object gives several fields at once: the kind's
  fixed ones plus any custom ones, each key becoming a field. `put` prints only the name.
- **Create only.** An existing name is refused. Pick another name or ask the owner to update
  the item in the Vault view. You cannot change, rotate or remove an item.
- New items get policy `ask` and no approved commands.
- **Tell the user**, in one or two sentences: what you stored and under which name, and that
  the value was seen in this conversation (so it has already reached the model provider and
  this transcript) and they may want to rotate it. Do not repeat the value, even partly.
- Do not leave the secret behind: if you wrote it to a temporary file to store it, remove the
  file. Do not edit a user's own config files to remove a secret unless they ask.

## Finding what is stored

```bash
pocket-vault list                      # names, kinds, urls, tags, policy, expiry, last used
pocket-vault list --kind login --tag zoho
pocket-vault show zoho-books           # metadata, which fields exist, approved commands
pocket-vault history                   # this session's uses of the Vault
```

None of these show a value or the owner's notes. "What credentials do we have" means
`list`. If the item you need is not there, say so and ask the user to add it in the Vault view.

## If the Vault is off

`pocket-vault` exits with code 3 and says so. Tell the user that the Vault is turned off and
can be turned on in Pocket Code under **Settings → Projects, files, tasks & vault → Vault**
(it also needs `POCKET_VAULT_KEY` set on the server). Do not keep secrets anywhere else
instead, and still do not ask for one in the chat.
