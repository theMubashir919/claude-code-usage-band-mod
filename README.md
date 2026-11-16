# usage-band

A Claude Code mod that draws a one-line band above the prompt showing:

- **ctx**: how full the context window is, as a bar, a percentage and tokens used out of the window size.
- **session** and **week**: your plan's 5-hour and 7-day usage limits, with the time left until each resets and the local reset time.

The plan limits are read account-wide (every window and device on your account counts), so the band stays accurate even when you use Claude Code in several places at once. The band refreshes every 30 seconds for context and every 60 seconds for account limits, even when no turn is running.

Account-wide limits need a Claude subscription login. With an API key, only the current session's figures are shown.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-band --marketplace theMubashir919/claude-code-usage-band-mod
```

From a shell:

```
claude plugin install usage-band --marketplace theMubashir919/claude-code-usage-band-mod
```

Answer `y` to add the marketplace, then pick the user scope. In the desktop app, click + next to the prompt box, then Plugins, Add marketplace with `theMubashir919/claude-code-usage-band-mod`, then Add plugin.

## Update

```
claude plugin marketplace update claude-code-usage-band-mod
claude plugin update usage-band@claude-code-usage-band-mod
```
