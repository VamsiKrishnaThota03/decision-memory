import React, { useState } from 'react';
import { Box, Button, Checkbox, Inline, Lozenge, SectionMessage, Stack, Strong, Text, TextArea } from '@forge/react';
import { call, cardStyle, ErrorBanner, GuardrailTags } from '../shared.jsx';

const SAMPLE = `# ADR-004: Use Kafka for event streaming

## Status
Accepted

## Context
Teams currently mix SQS, RabbitMQ and webhooks for events.

## Decision
We will use Kafka instead of RabbitMQ for all new event streams.`;

/**
 * Preview drafts with checkboxes and import the selected ones (by id). Proposed
 * ADRs are shown but can't be selected. Remount with a new `key` per preview.
 */
export function DraftPicker({ drafts, onImport, busy, note }) {
  const [selected, setSelected] = useState(() => new Set(drafts.filter((d) => d.selectable).map((d) => d.id)));
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Stack space="space.150">
      {drafts.map((d) => (
        <Box key={d.id} xcss={cardStyle}>
          <Stack space="space.075">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Checkbox
                isChecked={selected.has(d.id)}
                isDisabled={!d.selectable}
                onChange={() => toggle(d.id)}
                label={d.title || d.statement}
              />
              {d.status !== 'active' ? <Lozenge appearance={d.status === 'proposed' ? 'new' : 'moved'}>{d.status}</Lozenge> : null}
            </Inline>
            {d.title ? <Text size="small">{d.statement}</Text> : null}
            {!d.selectable ? <Text size="small">Proposed ADRs are imported once they're accepted.</Text> : null}
            <GuardrailTags avoid={d.guardrails?.avoid ?? []} prefer={d.guardrails?.prefer ?? []} />
          </Stack>
        </Box>
      ))}
      {note ? <Text size="small">{note}</Text> : null}
      <Inline>
        <Button appearance="primary" isDisabled={busy || !selected.size} onClick={() => onImport([...selected])}>
          {busy ? 'Importing…' : `Import ${selected.size} decision${selected.size === 1 ? '' : 's'}`}
        </Button>
      </Inline>
    </Stack>
  );
}

export function ImportResults({ results }) {
  if (!results) return null;
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return (
    <SectionMessage appearance={failed.length ? 'warning' : 'success'} title={`Imported ${ok.filter((r) => r.created).length} new decision(s)`}>
      <Stack space="space.050">
        {ok.map((r) => (
          <Text key={r.key}>
            <Strong>{r.key}</Strong> {r.title} {r.created ? '' : '(already existed)'}
          </Text>
        ))}
        {failed.map((r) => (
          <Text key={`f-${r.title}`}>
            Skipped “{r.title}”: {r.error}
          </Text>
        ))}
      </Stack>
    </SectionMessage>
  );
}

export function ImportTab({ onChanged }) {
  const [markdown, setMarkdown] = useState('');
  const [drafts, setDrafts] = useState(null);
  const [previewId, setPreviewId] = useState(0);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const preview = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      setDrafts(await call('previewImport', { markdown }));
      setPreviewId((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (ids) => {
    setBusy(true);
    setError(null);
    try {
      setResults(await call('importDecisions', { markdown, ids }));
      setDrafts(null);
      setMarkdown('');
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack space="space.200">
      <Text>
        Paste Architecture Decision Records (Markdown, Nygard or MADR style), meeting notes with “Decision:” lines, or
        several ADRs at once. Superseded ADRs are imported as history.
      </Text>
      <TextArea value={markdown} placeholder={SAMPLE} onChange={(e) => setMarkdown(e.target.value)} />
      <Inline space="space.100">
        <Button onClick={preview} isDisabled={busy || markdown.trim().length < 8}>
          Preview
        </Button>
        <Button appearance="subtle" onClick={() => setMarkdown(SAMPLE)}>
          Use example
        </Button>
      </Inline>
      <ErrorBanner error={error} />
      {drafts && !drafts.length ? (
        <SectionMessage appearance="information" title="No decisions found">
          <Text>Use a “## Decision” section or lines starting with “Decision:”.</Text>
        </SectionMessage>
      ) : null}
      {drafts?.length ? (
        <DraftPicker
          key={previewId}
          drafts={drafts}
          onImport={doImport}
          busy={busy}
          note="Imported decisions are site-wide: everyone using Decision Memory can see them."
        />
      ) : null}
      <ImportResults results={results} />
    </Stack>
  );
}
