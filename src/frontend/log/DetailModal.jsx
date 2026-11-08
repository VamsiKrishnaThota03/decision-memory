import React, { useState } from 'react';
import {
  Box,
  Button,
  DatePicker,
  ErrorMessage,
  Heading,
  Inline,
  Label,
  Link,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  TextArea,
  Textfield,
  User,
} from '@forge/react';
import {
  call,
  cardStyle,
  DecisionFormModal,
  ErrorBanner,
  GuardrailTags,
  shortDate,
  StatusLozenge,
  useResolver,
} from '../shared.jsx';

function Lineage({ lineage, currentId }) {
  if (!lineage || lineage.length < 2) return null;
  return (
    <Stack space="space.050">
      <Heading size="xsmall">History</Heading>
      <Inline space="space.075" alignBlock="center" shouldWrap>
        {lineage.map((x, i) => (
          <Inline key={x.id} space="space.075" alignBlock="center">
            {i ? <Text>→</Text> : null}
            <Lozenge appearance={x.id === currentId ? 'inprogress' : x.status === 'active' ? 'success' : 'default'} isBold={x.id === currentId}>
              {x.key}
            </Lozenge>
            <Text size="small">{x.title.length > 40 ? `${x.title.slice(0, 39)}…` : x.title}</Text>
          </Inline>
        ))}
      </Inline>
    </Stack>
  );
}

function GuardrailEditor({ decision, onCancel, onSaved }) {
  const [avoid, setAvoid] = useState(decision.avoidTerms.join(', '));
  const [prefer, setPrefer] = useState(decision.preferTerms.join(', '));
  const [tags, setTags] = useState(decision.tags.join(', '));
  const [reviewBy, setReviewBy] = useState(decision.reviewBy ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('editGuardrails', { key: decision.key, avoidTerms: avoid, preferTerms: prefer, tags, reviewBy });
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Box xcss={cardStyle}>
      <Stack space="space.100">
        <Text>
          <Strong>Edit guardrails.</Strong> Comma-separated. Add a scope in brackets to narrow a term, e.g.
          “feature flags (in payments service)”.
        </Text>
        <Box>
          <Label labelFor="dm-edit-avoid">Avoid</Label>
          <Textfield id="dm-edit-avoid" value={avoid} onChange={(e) => setAvoid(e.target.value)} />
        </Box>
        <Box>
          <Label labelFor="dm-edit-prefer">Prefer</Label>
          <Textfield id="dm-edit-prefer" value={prefer} onChange={(e) => setPrefer(e.target.value)} />
        </Box>
        <Inline space="space.150" shouldWrap>
          <Box>
            <Label labelFor="dm-edit-tags">Tags</Label>
            <Textfield id="dm-edit-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Box>
          <Box>
            <Label labelFor="dm-edit-review">Revisit by</Label>
            <DatePicker id="dm-edit-review" value={reviewBy} onChange={(v) => setReviewBy(v ?? '')} />
          </Box>
        </Inline>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <Inline space="space.100">
          <Button appearance="primary" onClick={save} isDisabled={busy}>
            {busy ? 'Saving…' : 'Save guardrails'}
          </Button>
          <Button appearance="subtle" onClick={onCancel}>
            Cancel
          </Button>
        </Inline>
      </Stack>
    </Box>
  );
}

export function DetailModal({ decisionKey, onClose, onChanged }) {
  const { loading, data, error, reload } = useResolver('getDecision', { key: decisionKey }, [decisionKey]);
  const [mode, setMode] = useState(null); // 'supersede' | 'revoke' | 'edit'
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const changed = async () => {
    setMode(null);
    await reload();
    onChanged();
  };

  const revoke = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await call('revokeDecision', { key: decisionKey, reason });
      await changed();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'supersede' && data) {
    return <DecisionFormModal mode="supersede" supersedes={data.decision} onClose={() => setMode(null)} onSaved={changed} />;
  }

  const d = data?.decision;
  const canManage = Boolean(data?.viewerCanManage);
  return (
    <Modal onClose={onClose} width="large">
      <ModalHeader>
        <ModalTitle>{d ? `${d.key} · ${d.title}` : decisionKey}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {loading && !data ? <Spinner /> : null}
        <ErrorBanner error={error} onRetry={reload} />
        {d ? (
          <Stack space="space.200">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <StatusLozenge status={d.status} />
              <Text size="small">Decided {shortDate(d.createdAt)}</Text>
              <Text size="small">· {d.projectKey ? `Visible to project ${d.projectKey}` : 'Site-wide'}</Text>
              {d.reviewBy ? <Text size="small">· Revisit by {d.reviewBy}</Text> : null}
            </Inline>
            <Box xcss={cardStyle}>
              <Text>{d.statement}</Text>
            </Box>
            {d.rationale ? (
              <Stack space="space.050">
                <Heading size="xsmall">Why</Heading>
                <Text>{d.rationale}</Text>
              </Stack>
            ) : null}
            {mode === 'edit' ? (
              <GuardrailEditor decision={d} onCancel={() => setMode(null)} onSaved={changed} />
            ) : (
              <Stack space="space.050">
                <Inline space="space.100" alignBlock="center">
                  <Heading size="xsmall">Guardrails</Heading>
                  {canManage && d.status === 'active' ? (
                    <Button appearance="subtle" onClick={() => setMode('edit')}>
                      Edit
                    </Button>
                  ) : null}
                </Inline>
                <GuardrailTags avoid={d.avoidTerms} prefer={d.preferTerms} />
              </Stack>
            )}
            {data.needsTuning ? (
              <SectionMessage appearance="warning" title="People often dismiss this decision's alerts">
                <Text>
                  Dismissed {data.alerts.dismissed}× vs acknowledged {data.alerts.acknowledged}×. Narrow the guardrails
                  (add a scope) so alerts stay useful. Until then, only high-confidence conflicts post comments.
                </Text>
              </SectionMessage>
            ) : null}
            <Inline space="space.300" shouldWrap alignBlock="start">
              {d.ownerAccountId ? (
                <Stack space="space.050">
                  <Heading size="xsmall">Owner</Heading>
                  <User accountId={d.ownerAccountId} />
                </Stack>
              ) : null}
              <Stack space="space.050">
                <Heading size="xsmall">Owner's teams</Heading>
                {data.ownerTeams?.available && data.ownerTeams.teams.length ? (
                  <Text>{data.ownerTeams.teams.map((t) => t.name).join(', ')}</Text>
                ) : (
                  <Text size="small">{data.ownerTeams?.available ? 'No teams found' : 'Teamwork Graph not available'}</Text>
                )}
              </Stack>
              <Stack space="space.050">
                <Heading size="xsmall">Conflicts caught</Heading>
                <Text>
                  {data.alerts.open + data.alerts.acknowledged + data.alerts.dismissed} (open {data.alerts.open})
                </Text>
              </Stack>
              {d.sourceUrl ? (
                <Stack space="space.050">
                  <Heading size="xsmall">Source</Heading>
                  <Link href={d.sourceUrl} openNewTab>
                    {d.issueKey ?? 'Open source'}
                  </Link>
                </Stack>
              ) : null}
            </Inline>
            <Lineage lineage={data.lineage} currentId={d.id} />
            {d.status !== 'active' ? (
              <SectionMessage appearance="warning" title={`This decision is ${d.status}`}>
                <Text>
                  {d.statusReason ?? ''}
                  {data.supersededBy ? ` → Now: ${data.supersededBy.key} ${data.supersededBy.title}` : ''}
                </Text>
              </SectionMessage>
            ) : null}
            {mode === 'revoke' ? (
              <Stack space="space.100">
                <Label labelFor="dm-revoke-reason">Why is this decision no longer valid?</Label>
                <TextArea id="dm-revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                {actionError ? <ErrorMessage>{actionError}</ErrorMessage> : null}
                <Inline space="space.100">
                  <Button appearance="danger" onClick={revoke} isDisabled={busy || reason.trim().length < 3}>
                    Revoke decision
                  </Button>
                  <Button appearance="subtle" onClick={() => setMode(null)}>
                    Cancel
                  </Button>
                </Inline>
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </ModalBody>
      <ModalFooter>
        {d?.status === 'active' && canManage && !mode ? (
          <>
            <Button appearance="subtle" onClick={() => setMode('revoke')}>
              Revoke
            </Button>
            <Button onClick={() => setMode('supersede')}>Supersede</Button>
          </>
        ) : null}
        <Button appearance="primary" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
