# Triage labels

**Vocabulary:** Default

| Label | Meaning |
|-------|---------|
| `needs-triage` | New issue, needs initial assessment |
| `needs-info` | Awaiting information from reporter |
| `ready-for-agent` | Ready for an agent to work on |
| `ready-for-human` | Needs human review/decision |
| `wontfix` | Closed, won't address |

## Workflow

```
needs-triage → ready-for-agent → in-progress → done
                 ↓
            needs-info → needs-triage

needs-triage → ready-for-human → done

Any → wontfix
```