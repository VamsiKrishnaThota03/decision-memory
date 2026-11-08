import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  Toggle,
} from '@forge/react';
import { call, cardStyle, ErrorBanner, useResolver } from './shared.jsx';

const SEVERITY = [
  { label: 'Medium and high confidence', value: 'medium' },
  { label: 'High confidence only', value: 'high' },
];

function Setting({ id, label, description, checked, onChange }) {
  return (
    <Inline space="space.150" alignBlock="start">
      <Toggle id={id} isChecked={checked} onChange={(e) => onChange(e.target.checked)} />
      <Stack space="space.025">
        <Label labelFor={id}>{label}</Label>
        <Text size="small">{description}</Text>
      </Stack>
    </Inline>
  );
}

function App() {
  const { loading, data, error, reload } = useResolver('getSettings', {}, []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data]);

  if (loading && !form) return <Spinner />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!form) return null;

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      setForm(await call('saveSettings', { settings: form }));
      setNotice({ appearance: 'success', text: 'Settings saved.' });
    } catch (e) {
      setNotice({ appearance: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading size="large">Decision Memory settings</Heading>
        <Text>Control how Decision Memory captures decisions and flags conflicts across this site.</Text>
      </Stack>

      <Box xcss={cardStyle}>
        <Stack space="space.200">
          <Heading size="small">Conflict alerts</Heading>
          <Setting id="s-auto" label="Comment on conflicting issues" description="Post one explanatory comment when new work contradicts a decision." checked={form.autoComment} onChange={set('autoComment')} />
          <Setting id="s-label" label="Add the decision-conflict label" description="Makes conflicts filterable in JQL, boards and dashboards." checked={form.addLabel} onChange={set('addLabel')} />
          <Setting id="s-comments" label="Check new comments too" description="Catch drift mid-work, e.g. “let's just use Mongo here”." checked={form.checkComments} onChange={set('checkComments')} />
          <Box>
            <Label labelFor="s-severity">Minimum confidence for automatic comments</Label>
            <Select
              id="s-severity"
              options={SEVERITY}
              value={SEVERITY.find((o) => o.value === form.minSeverity)}
              onChange={(o) => set('minSeverity')(o?.value ?? 'medium')}
            />
          </Box>
          <Box>
            <Label labelFor="s-quiet">Quiet a decision after this many dismissals</Label>
            <Textfield
              id="s-quiet"
              type="number"
              value={String(form.quietAfterDismissals)}
              onChange={(e) => set('quietAfterDismissals')(e.target.value)}
            />
            <Text size="small">Noisy decisions then only comment on high-confidence conflicts until their guardrails are refined.</Text>
          </Box>
        </Stack>
      </Box>

      <Box xcss={cardStyle}>
        <Stack space="space.200">
          <Heading size="small">Capture and hygiene</Heading>
          <Setting id="s-capture" label="Capture decisions from comments" description="“Decision: …” lines and native /decision blocks become decisions." checked={form.captureFromComments} onChange={set('captureFromComments')} />
          <Setting id="s-review" label="Review reminders" description="Remind owners (weekly) when a decision passes its review date." checked={form.reviewReminders} onChange={set('reviewReminders')} />
        </Stack>
      </Box>

      <Box xcss={cardStyle}>
        <Stack space="space.100">
          <Inline space="space.100" alignBlock="center">
            <Heading size="small">Teamwork Graph</Heading>
            <Lozenge appearance={data.graph.connected ? 'success' : 'default'}>{data.graph.connected ? 'connected' : 'not connected'}</Lozenge>
          </Inline>
          <Text>
            Publishes site-wide decisions into the Teamwork Graph, linked to their Jira issues, so Rovo search and other
            agents can find them. Connect it in Atlassian Administration → Apps → Sites → Connected apps → Decision Memory →
            Connections.
          </Text>
          {data.graph.connections.map((c) => (
            <Text key={c.connectedAt} size="small">
              {c.name || 'Connection'} — connected {String(c.connectedAt).slice(0, 10)}
            </Text>
          ))}
        </Stack>
      </Box>

      {notice ? (
        <SectionMessage appearance={notice.appearance}>
          <Text>{notice.text}</Text>
        </SectionMessage>
      ) : null}
      <Inline>
        <Button appearance="primary" onClick={save} isDisabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </Inline>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
