import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  EmptyState,
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
  ModalTransition,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  Textfield,
  User,
  xcss,
} from '@forge/react';
import { call, cardStyle, DecisionFormModal, ErrorBanner, shortDate, statStyle, StatusLozenge, useResolver } from './shared.jsx';
import { DetailModal } from './log/DetailModal.jsx';
import { ImportTab } from './log/ImportTab.jsx';
import { InsightsTab } from './log/InsightsTab.jsx';

const tabPanelStyle = xcss({ paddingBlock: 'space.200', width: '100%' });

const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Superseded', value: 'superseded' },
  { label: 'Revoked', value: 'revoked' },
  { label: 'All statuses', value: 'all' },
];

function Stat({ label, value, appearance }) {
  return (
    <Box xcss={statStyle}>
      <Stack space="space.050">
        <Text size="small">{label}</Text>
        <Inline alignBlock="center" space="space.050">
          <Heading size="large">{String(value ?? '—')}</Heading>
          {appearance ? <Lozenge appearance={appearance}>{label === 'Open conflicts' ? 'needs attention' : 'review'}</Lozenge> : null}
        </Inline>
      </Stack>
    </Box>
  );
}

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function DecisionsTab({ refreshKey, onChanged }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(STATUS_OPTIONS[0]);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const q = useDebounced(query);
  const { loading, data, error, reload } = useResolver(
    'listDecisions',
    { query: q, status: status.value === 'all' ? null : status.value, includeInactive: status.value !== 'active' },
    [q, status.value, refreshKey],
  );

  const head = {
    cells: [
      { key: 'key', content: 'Key', width: 9 },
      { key: 'title', content: 'Decision', width: 41 },
      { key: 'status', content: 'Status', width: 12 },
      { key: 'owner', content: 'Owner', width: 16 },
      { key: 'scope', content: 'Scope', width: 10 },
      { key: 'date', content: 'Decided', width: 12 },
    ],
  };
  const rows = (data ?? []).map((d) => ({
    key: String(d.id),
    cells: [
      { key: 'key', content: <Lozenge isBold>{d.key}</Lozenge> },
      {
        key: 'title',
        content: (
          <Button appearance="subtle" onClick={() => setSelected(d.key)}>
            {d.title}
          </Button>
        ),
      },
      { key: 'status', content: <StatusLozenge status={d.status} /> },
      { key: 'owner', content: d.ownerAccountId ? <User accountId={d.ownerAccountId} /> : '—' },
      { key: 'scope', content: d.projectKey ?? 'Site' },
      { key: 'date', content: shortDate(d.createdAt) },
    ],
  }));

  return (
    <Stack space="space.200">
      <Inline space="space.150" alignBlock="end" shouldWrap>
        <Box>
          <Label labelFor="dm-search">Search decisions</Label>
          <Textfield id="dm-search" value={query} placeholder="database, deploys, DEC-12…" onChange={(e) => setQuery(e.target.value)} />
        </Box>
        <Box>
          <Label labelFor="dm-status">Status</Label>
          <Select id="dm-status" options={STATUS_OPTIONS} value={status} onChange={(o) => setStatus(o ?? STATUS_OPTIONS[0])} />
        </Box>
        <Button appearance="primary" onClick={() => setShowForm(true)}>
          Record a decision
        </Button>
      </Inline>
      <ErrorBanner error={error} onRetry={reload} />
      <DynamicTable
        head={head}
        rows={rows}
        isLoading={loading}
        rowsPerPage={20}
        emptyView={
          <EmptyState
            header={q ? 'No matching decisions' : 'No decisions yet'}
            description="Record one here, ask the Decision Memory agent in Rovo, or write “Decision: …” in any Jira comment."
          />
        }
      />
      <ModalTransition>
        {selected ? (
          <DetailModal
            decisionKey={selected}
            onClose={() => setSelected(null)}
            onChanged={() => {
              reload();
              onChanged();
            }}
          />
        ) : null}
        {showForm ? (
          <DecisionFormModal
            onClose={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              reload();
              onChanged();
            }}
          />
        ) : null}
      </ModalTransition>
    </Stack>
  );
}

function CheckTab() {
  const [text, setText] = useState('');
  const [state, setState] = useState({ loading: false, result: null, error: null });

  const run = async () => {
    setState({ loading: true, result: null, error: null });
    try {
      setState({ loading: false, result: await call('checkText', { text }), error: null });
    } catch (e) {
      setState({ loading: false, result: null, error: e.message });
    }
  };
  const r = state.result;

  return (
    <Stack space="space.200">
      <Text>Paste a proposal, RFC summary or pull request description to check it against every active decision.</Text>
      <TextArea
        value={text}
        placeholder="We plan to add a MongoDB cluster for the new recommendations service and deploy it this Friday…"
        onChange={(e) => setText(e.target.value)}
      />
      <Inline>
        <Button appearance="primary" onClick={run} isDisabled={state.loading || text.trim().length < 3}>
          {state.loading ? 'Checking…' : 'Check against decisions'}
        </Button>
      </Inline>
      <ErrorBanner error={state.error} />
      {r ? (
        <Stack space="space.150">
          {r.conflicts.length ? (
            r.conflicts.map((c) => (
              <SectionMessage key={c.decision.id} appearance="warning" title={`${c.decision.key} · ${c.decision.title}`}>
                <Stack space="space.050">
                  <Text>{c.reason}</Text>
                  {c.evidence?.[0] ? <Text size="small">Evidence: “{c.evidence[0].snippet}”</Text> : null}
                </Stack>
              </SectionMessage>
            ))
          ) : (
            <SectionMessage appearance="success" title="No conflicts found">
              <Text>Nothing here contradicts an active decision.</Text>
            </SectionMessage>
          )}
          {r.aligned.map((a) => (
            <Text key={`a-${a.decision.id}`}>
              ✅ <Strong>{a.decision.key}</Strong> {a.reason}
            </Text>
          ))}
          {r.related.map((x) => (
            <Text key={`r-${x.decision.id}`}>
              🔗 Related: <Strong>{x.decision.key}</Strong> {x.decision.title}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function Onboarding({ onSeeded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const seed = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('seedDemo');
      onSeeded();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box xcss={cardStyle}>
      <Stack space="space.150">
        <Heading size="medium">Welcome to Decision Memory</Heading>
        <Text>Your team's decisions, remembered and enforced. Here's how it works:</Text>
        <Stack space="space.075">
          <Text>
            <Strong>1. Capture.</Strong> Write “Decision: …” in any Jira comment (or use /decision), record one here, or ask
            the Decision Memory agent in Rovo to capture decisions from a Confluence page.
          </Text>
          <Text>
            <Strong>2. Guard.</Strong> Each decision becomes guardrails: what to avoid and what to prefer.
          </Text>
          <Text>
            <Strong>3. Catch.</Strong> When new work contradicts a decision, the issue gets one clear comment with the
            evidence, the reason, and the decision owner.
          </Text>
        </Stack>
        <Inline space="space.100">
          <Button appearance="primary" onClick={seed} isDisabled={busy}>
            {busy ? 'Loading…' : 'Load 5 sample decisions'}
          </Button>
        </Inline>
        <Text size="small">
          Then create an issue called “Add MongoDB cluster for recommendations” to see a conflict caught.
        </Text>
        <ErrorBanner error={error} />
      </Stack>
    </Box>
  );
}

function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);
  const stats = useResolver('getStats', {}, [refreshKey]);
  const s = stats.data ?? {};
  const isEmpty = stats.data && !s.active;
  return (
    <Stack space="space.300">
      {/* Jira already renders the page title ("Decision Log") above the app. */}
      <Text>What your team decided, why, and whether new work still follows it.</Text>
      <ErrorBanner error={stats.error} onRetry={stats.reload} />
      {isEmpty ? <Onboarding onSeeded={bump} /> : null}
      <Inline space="space.150" shouldWrap>
        <Stat label="Active decisions" value={s.active} />
        <Stat label="Open conflicts" value={s.openConflicts} appearance={s.openConflicts ? 'removed' : undefined} />
        <Stat label="Due for review" value={s.dueForReview} appearance={s.dueForReview ? 'moved' : undefined} />
        <Stat label="Superseded" value={s.superseded} />
      </Inline>
      <Tabs id="dm-tabs">
        <TabList>
          <Tab>Decisions</Tab>
          <Tab>Check a proposal</Tab>
          <Tab>Import ADRs</Tab>
          <Tab>Insights</Tab>
        </TabList>
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <DecisionsTab refreshKey={refreshKey} onChanged={bump} />
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <CheckTab />
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <ImportTab onChanged={bump} />
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <InsightsTab refreshKey={refreshKey} />
          </Box>
        </TabPanel>
      </Tabs>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
