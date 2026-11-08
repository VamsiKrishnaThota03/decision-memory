import React, { useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Link,
  Lozenge,
  ModalTransition,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  User,
} from '@forge/react';
import { call, cardStyle, DecisionFormModal, ErrorBanner, GuardrailTags, useResolver } from './shared.jsx';

function ConflictCard({ finding, onStatus, busy }) {
  const d = finding.decision;
  const resolved = finding.alertStatus !== 'open';
  return (
    <Box xcss={cardStyle}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Lozenge appearance={finding.severity === 'high' ? 'removed' : 'moved'} isBold>
            {finding.severity === 'high' ? 'Conflict' : 'Possible conflict'}
          </Lozenge>
          <Text>
            <Strong>{d.key}</Strong> {d.title}
          </Text>
          {resolved ? <Lozenge>{finding.alertStatus}</Lozenge> : null}
        </Inline>
        <Text>{finding.reason}</Text>
        {finding.evidence?.[0] ? <Text size="small">Evidence: “{finding.evidence[0].snippet}”</Text> : null}
        {d.rationale ? <Text size="small">Why it was decided: {d.rationale}</Text> : null}
        <Inline space="space.100" alignBlock="center" shouldWrap>
          {d.ownerAccountId ? (
            <Inline space="space.050" alignBlock="center">
              <Text size="small">Owner</Text>
              <User accountId={d.ownerAccountId} />
            </Inline>
          ) : null}
          {d.sourceUrl ? (
            <Link href={d.sourceUrl} openNewTab>
              Source
            </Link>
          ) : null}
        </Inline>
        {!resolved ? (
          <Inline space="space.100">
            <Button appearance="primary" isDisabled={busy} onClick={() => onStatus(d.key, 'acknowledged')}>
              Acknowledge
            </Button>
            <Button appearance="subtle" isDisabled={busy} onClick={() => onStatus(d.key, 'dismissed')}>
              Not a conflict
            </Button>
          </Inline>
        ) : (
          <Inline>
            <Button appearance="subtle" isDisabled={busy} onClick={() => onStatus(d.key, 'open')}>
              Reopen
            </Button>
          </Inline>
        )}
      </Stack>
    </Box>
  );
}

function DecisionLine({ decision, note }) {
  return (
    <Stack space="space.025">
      <Text>
        <Strong>{decision.key}</Strong> {decision.title}
      </Text>
      {note ? <Text size="small">{note}</Text> : null}
    </Stack>
  );
}

function App() {
  const { loading, data, error, reload } = useResolver('getIssueInsights', {}, []);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState(null);

  const setStatus = async (decisionKey, status) => {
    setBusy(true);
    setActionError(null);
    try {
      await call('setAlertStatus', { decisionKey, status });
      await reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text>Checking this issue against team decisions…</Text>
      </Inline>
    );
  }
  if (error) return <ErrorBanner error={error} onRetry={reload} />;

  const openConflicts = data.conflicts.filter((c) => c.alertStatus === 'open');
  const nothing = !data.conflicts.length && !data.aligned.length && !data.related.length && !data.captured.length;

  return (
    <Stack space="space.200">
      {notice ? (
        <SectionMessage appearance={notice.appearance} title={notice.title}>
          <Text>{notice.text}</Text>
        </SectionMessage>
      ) : null}
      <ErrorBanner error={actionError} />

      {data.conflicts.length ? (
        <Stack space="space.100">
          <Heading size="small">
            {openConflicts.length
              ? `${openConflicts.length} decision conflict${openConflicts.length > 1 ? 's' : ''} to resolve`
              : 'Conflicts reviewed'}
          </Heading>
          {data.conflicts.map((c) => (
            <ConflictCard key={c.decision.id} finding={c} onStatus={setStatus} busy={busy} />
          ))}
        </Stack>
      ) : (
        <SectionMessage appearance="success" title="No conflicts with recorded decisions">
          <Text>This issue doesn't contradict anything your team has decided.</Text>
        </SectionMessage>
      )}

      {data.aligned.length ? (
        <Stack space="space.100">
          <Heading size="xsmall">Implements</Heading>
          {data.aligned.map((a) => (
            <DecisionLine key={a.decision.id} decision={a.decision} note={a.reason} />
          ))}
        </Stack>
      ) : null}

      {data.related.length ? (
        <Stack space="space.100">
          <Heading size="xsmall">Related decisions</Heading>
          {data.related.map((r) => (
            <DecisionLine key={r.decision.id} decision={r.decision} note={`Shared topics: ${r.matched.join(', ')}`} />
          ))}
        </Stack>
      ) : null}

      {data.captured.length ? (
        <Stack space="space.100">
          <Heading size="xsmall">Decided on this issue</Heading>
          {data.captured.map((d) => (
            <Stack key={d.id} space="space.050">
              <DecisionLine decision={d} />
              <GuardrailTags avoid={d.avoidTerms} prefer={d.preferTerms} />
            </Stack>
          ))}
        </Stack>
      ) : null}

      {data.dueForReview.length ? (
        <SectionMessage appearance="discovery" title="Due for review">
          <Text>
            {data.dueForReview.map((d) => d.key).join(', ')} passed the review date. Check whether the decision still holds.
          </Text>
        </SectionMessage>
      ) : null}

      {nothing ? (
        <Text size="small">
          Tip: write “Decision: …” in a comment, or use /decision in the editor, and Decision Memory captures it automatically.
        </Text>
      ) : null}

      <Inline space="space.100">
        <Button onClick={() => setShowForm(true)}>Record a decision</Button>
        <Button appearance="subtle" onClick={reload} isDisabled={loading}>
          Refresh
        </Button>
      </Inline>

      <ModalTransition>
        {showForm ? (
          <DecisionFormModal
            showScope
            onClose={() => setShowForm(false)}
            onSaved={(result) => {
              setShowForm(false);
              setNotice(
                result.contradicts?.length
                  ? {
                      appearance: 'warning',
                      title: `Recorded ${result.decision.key}, but it contradicts an existing decision`,
                      text: `Check ${result.contradicts.map((c) => c.key).join(', ')} and supersede it from the Decision Log if it no longer applies.`,
                    }
                  : { appearance: 'success', title: `Recorded ${result.decision.key}`, text: result.decision.title },
              );
              reload();
            }}
          />
        ) : null}
      </ModalTransition>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
