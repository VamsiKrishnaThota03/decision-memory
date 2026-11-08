import React from 'react';
import ForgeReconciler, { Box, Heading, Inline, Spinner, Stack, Strong, Text, User } from '@forge/react';
import { cardStyle, ErrorBanner, GuardrailTags, shortDate, StatusLozenge, useResolver } from './shared.jsx';

/** Confluence macro: the team's most recent active decisions, embedded in any page. */
function App() {
  const { loading, data, error, reload } = useResolver('getMacroDecisions', {}, []);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  return (
    <Stack space="space.150">
      <Heading size="small">Team decisions</Heading>
      {data.length ? (
        data.map((d) => (
          <Box key={d.id} xcss={cardStyle}>
            <Stack space="space.075">
              <Inline space="space.100" alignBlock="center" shouldWrap>
                <Text>
                  <Strong>{d.key}</Strong> {d.title}
                </Text>
                <StatusLozenge status={d.status} />
              </Inline>
              {d.rationale ? <Text size="small">Why: {d.rationale}</Text> : null}
              <GuardrailTags avoid={d.avoidTerms} prefer={d.preferTerms} />
              <Inline space="space.100" alignBlock="center">
                {d.ownerAccountId ? <User accountId={d.ownerAccountId} /> : null}
                <Text size="small">Decided {shortDate(d.createdAt)}</Text>
              </Inline>
            </Stack>
          </Box>
        ))
      ) : (
        <Text>No decisions recorded yet.</Text>
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
