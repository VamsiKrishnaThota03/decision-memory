import React, { useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { view } from '@forge/bridge';
import { call, ErrorBanner, useResolver } from './shared.jsx';
import { DraftPicker, ImportResults } from './log/ImportTab.jsx';

/** Confluence page "⋯" action: capture the decisions written on this page. */
function App() {
  const { loading, data, error, reload } = useResolver('getPageDecisions', {}, []);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState(null);

  const doImport = async (ids) => {
    setBusy(true);
    setImportError(null);
    try {
      setResults(await call('importFromPage', { ids }));
    } catch (e) {
      setImportError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text>Reading decisions on this page…</Text>
      </Inline>
    );
  }
  if (error) return <ErrorBanner error={error} onRetry={reload} />;

  return (
    <Stack space="space.200">
      <Heading size="small">Capture decisions from “{data.page.title}”</Heading>
      {results ? (
        <ImportResults results={results} />
      ) : data.drafts.length ? (
        <>
          <Text>Select the decisions to remember. Future Jira work that contradicts them will be flagged.</Text>
          <DraftPicker
            drafts={data.drafts}
            onImport={doImport}
            busy={busy}
            note="Imported decisions are site-wide: everyone using Decision Memory (and the Teamwork Graph, if connected) can see them. Don't import from restricted pages."
          />
        </>
      ) : (
        <SectionMessage appearance="information" title="No decisions found on this page">
          <Text>Add a decision block (type /decision), a line starting with “Decision:”, or an ADR “Decision” heading.</Text>
        </SectionMessage>
      )}
      <ErrorBanner error={importError} />
      <Inline>
        <Button appearance="subtle" onClick={() => view.close()}>
          Close
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
