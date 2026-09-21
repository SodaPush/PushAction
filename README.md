# SodaPush Action

Send APNs notifications from GitHub Actions through a [SodaPush Server](https://github.com/SodaPush/Server) you control. The action signs in with a normal SodaPush user, creates a push job through the public API, optionally waits for delivery to finish, and signs out.

## Usage

Store the Server password as a GitHub Actions secret, then add a step like this:

```yaml
- name: Notify beta users
  id: push
  uses: SodaPush/PushAction@main
  with:
    server-url: ${{ secrets.SODAPUSH_SERVER_URL }}
    username: ${{ secrets.SODAPUSH_USERNAME }}
    password: ${{ secrets.SODAPUSH_PASSWORD }}
    app-id: ${{ vars.SODAPUSH_APP_ID }}
    environment: production
    target: '{"tags":["beta"]}'
    title: Build ready
    body: Version ${{ github.ref_name }} is ready to test.
```

The user must have owner, admin, or developer access to the selected app. `server-url` may be a domain or IP address, but it must include `https://` or `http://`. HTTPS is strongly recommended whenever the Server is reachable over the internet.

For a complete custom APNs payload, provide `payload` instead of `title` and `body`:

```yaml
- uses: SodaPush/PushAction@main
  with:
    server-url: ${{ secrets.SODAPUSH_SERVER_URL }}
    username: ${{ secrets.SODAPUSH_USERNAME }}
    password: ${{ secrets.SODAPUSH_PASSWORD }}
    app-id: ${{ vars.SODAPUSH_APP_ID }}
    environment: development
    push-type: background
    target: '{"userIDs":["customer-42"]}'
    payload: '{"aps":{"content-available":1},"operation":"refresh"}'
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `server-url` | Yes | — | SodaPush Server base URL, including the URL scheme |
| `username` | Yes | — | Server user with push permission |
| `password` | Yes | — | Server password; use a GitHub Actions secret |
| `app-id` | Yes | — | SodaPush application ID |
| `environment` | No | `production` | `development` or `production` |
| `push-type` | No | `alert` | `alert`, `background`, or `liveactivity` |
| `target` | No | `{"all":true}` | One JSON selector: `all`, `installationIds`, `tags`, `languages`, or `userIDs` |
| `payload` | No | — | Complete APNs JSON object; required for Live Activities |
| `title` | No | — | Generated alert title when `payload` is omitted |
| `body` | Conditional | — | Generated alert body when an alert `payload` is omitted |
| `credential-id` | No | — | Specific APNs credential; otherwise the environment default is used |
| `wait` | No | `true` | Poll until the job is `completed`, `partial`, or `failed` |
| `timeout-seconds` | No | `120` | Polling timeout from 1 to 3600 seconds |

## Outputs

The action returns `job-id`, `status`, `total-count`, `success-count`, and `failure-count`. Delivery totals are zero when `wait` is disabled because processing may still be queued.

```yaml
- name: Check result
  run: echo "SodaPush status is ${{ steps.push.outputs.status }}"
```

## Security

- Put `username`, `password`, and externally sensitive Server URLs in GitHub Actions secrets.
- Prefer a dedicated developer user assigned only to the app the workflow needs.
- Use HTTPS for remote Servers. Plain HTTP is supported for private development networks and local runners only.
- The action masks the temporary access token and logs out after the request. It never prints the password or notification payload.

## Development

```sh
npm run check
```

## License

See [LICENSE](LICENSE).
