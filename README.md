# VEIL

### Inspect what AI agents read. Control what they do.

VEIL is a runtime security layer for AI agents that helps prevent untrusted content from triggering unauthorized tool actions. It inspects potentially malicious inputs, evaluates proposed actions against explicit security policies, and records decisions in an auditable trail.

**The core principle:** detecting a prompt injection is useful, but enforcing what an agent is allowed to do is the critical security boundary.



## The Problem

AI agents can browse webpages, read documents, process emails, and interact with external tools. These capabilities also create a security risk.

An attacker can embed malicious instructions in content an agent is asked to process. This is known as **indirect prompt injection**.

For example, a user asks an agent to summarize a webpage. The webpage contains an instruction to read a private file and email its contents to an unauthorized recipient.

The agent may treat this malicious content as an instruction rather than untrusted data.

Simply asking the model to ignore malicious instructions is not a sufficient security boundary.

## Our Approach

VEIL introduces a security layer around the agent's content-processing and tool-execution workflow.

- **Content inspection:** Analyze untrusted content for suspicious instructions and injection patterns.
- **Local AI analysis:** Use an open-weight model such as Gemma to help classify suspicious content, where supported by the implementation.
- **Policy enforcement:** Check proposed tool actions against explicit authorization rules.
- **Action control:** Prevent prohibited operations from executing through the protected tool gateway.
- **Audit trail:** Record security findings, policy decisions, reasons, and execution outcomes.
- **Evaluation:** Compare protected and unprotected runs using repeatable attack and benign test cases.

Detection and enforcement serve different purposes. A scanner can miss a malicious instruction; the policy engine must independently enforce the restrictions placed on sensitive actions.

## How It Works

```text
User Request
     |
     v
   AI Agent
     |
     v
Read Untrusted Content
     |
     v
Content Inspection
     |
     +----> Suspicious Content Findings
     |
     v
Agent Proposes Tool Action
     |
     v
Policy Enforcement Gateway
     |
     +----> BLOCK --> Audit Event
     |
     +----> ALLOW --> Execute Approved Tool
                            |
                            v
                      Record Outcome
```

The content scanner examines incoming information. The policy gateway checks outgoing tool calls before execution. The audit trail connects these decisions to the actual outcome.

## Demonstration Scenario

A user asks an AI agent to summarize a webpage and prepare an email.

The webpage contains a malicious instruction telling the agent to disclose a private file to an unauthorized address.

### Without VEIL

The agent may follow the malicious instruction and attempt an unauthorized action.

### With VEIL

1. The webpage is inspected for suspicious content.
2. The agent proposes an action.
3. The policy gateway checks whether that action is authorized.
4. An unauthorized action is blocked.
5. The legitimate summary can still be completed.
6. The dashboard displays the evidence and outcome.

The demonstration uses simulated files and a fake email outbox. It does not require real credentials, sensitive files, or external email delivery.

## Evaluation and Evidence

VEIL is designed to evaluate both security and usefulness rather than relying on a successful demonstration alone.

Planned measurements include:

| Metric | Purpose |
|---|---|
| Unauthorized action execution rate | Measures how often attacks result in prohibited actions |
| Attack block rate | Measures the proportion of attempted malicious actions that are blocked |
| Detection recall | Measures the proportion of labeled attacks detected by the scanner |
| False-positive rate | Measures how often legitimate cases are incorrectly flagged or blocked |
| Legitimate task completion | Measures whether normal tasks still succeed |
| Added latency | Measures the overhead introduced by security checks |

The evaluation compares the same scenarios under different configurations, such as no protection, deterministic detection and policy enforcement, and detection with local-model assistance.

All reported results must come from actual test runs. Test-set size, model configuration, failed cases, and known limitations should be documented alongside the results.

**VEIL does not claim universal or 100% protection against prompt injection.** Its objective is to demonstrate and measure concrete mitigations against defined attack scenarios.

## Technology

The implementation may use the following technologies, subject to the final working architecture.

- **Language:** Python
- **AI:** Gemma open-weight model through a supported local inference runtime
- **Backend:** Python API and policy-enforcement components
- **Frontend:** React and TypeScript
- **Testing:** Pytest and a reproducible security evaluation suite
- **Version control:** Git and GitHub

The local model assists with analysis; deterministic authorization rules remain responsible for enforcing protected actions.

## Project Scope

The initial prototype focuses on:

- A single, reproducible agent workflow
- Untrusted webpage fixtures
- Content inspection and suspicious-instruction reporting
- A small, explicit set of tool-authorization policies
- Simulated sensitive files and email actions
- An audit dashboard
- A repeatable attack-versus-benign evaluation

A general-purpose MCP security proxy, broader integrations, and advanced policy management are future extensions rather than prerequisites for the initial demonstration.

## Limitations

- Prompt-injection detection is imperfect.
- Unknown attack patterns may evade the scanner.
- Poorly designed policies may block legitimate operations or permit unsafe ones.
- A local model may add inference latency and produce incorrect classifications.
- Protection applies only to actions that actually pass through the enforcement boundary.
- Results on a small test set do not establish security against all future attacks.

## Roadmap

- [ ] Implement the content-inspection pipeline.
- [ ] Build the independent tool-policy enforcement layer.
- [ ] Add simulated tools and reproducible attack scenarios.
- [ ] Integrate local open-weight AI analysis.
- [ ] Connect the dashboard to real backend audit events.
- [ ] Implement baseline-versus-protected benchmarking.
- [ ] Publish setup instructions, test results, and known limitations.
- [ ] Explore MCP integration and broader agent compatibility.

## Contributing

Contributions are welcome. Priorities include reproducible security tests, additional prompt-injection scenarios, policy-engine improvements, false-positive reduction, and evaluation tooling.

Contributors should include tests for security-sensitive changes and avoid claiming protection that has not been demonstrated.

## License
Licensed under the **Apache License 2.0**. See [LICENSE](LICENSE). Copyright 2026 Supes MLH Hack team.

---
**VEIL — A measurable security boundary for AI agents.**
