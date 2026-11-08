import React from 'react';
import { BarChart, Box, DonutChart, Heading, Inline, SectionMessage, Spinner, Stack, Strong, Text } from '@forge/react';
import { cardStyle, ErrorBanner, statStyle, useResolver } from '../shared.jsx';

const SOURCE_LABEL = {
  'jira-comment': 'Jira comments',
  'jira-issue': 'Issue panel',
  confluence: 'Confluence',
  rovo: 'Rovo agent',
  manual: 'Decision Log',
  mcp: 'MCP',
};

function Metric({ label, value, hint }) {
  return (
    <Box xcss={statStyle}>
      <Stack space="space.050">
        <Text size="small">{label}</Text>
        <Heading size="large">{value == null ? '—' : String(value)}</Heading>
        {hint ? <Text size="small">{hint}</Text> : null}
      </Stack>
    </Box>
  );
}

export function InsightsTab({ refreshKey }) {
  const { loading, data, error, reload } = useResolver('getInsights', {}, [refreshKey]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const { totals, precision, conflictsByMonth, topDecisions, bySource, hygiene } = data;

  return (
    <Stack space="space.300">
      <Inline space="space.150" shouldWrap>
        <Metric label="Conflicts caught" value={totals.caught} hint="before the work shipped" />
        <Metric label="Acknowledged" value={totals.acknowledged} />
        <Metric label="Dismissed" value={totals.dismissed} />
        <Metric label="Alert precision" value={precision == null ? '—' : `${precision}%`} hint="acknowledged ÷ reviewed" />
      </Inline>

      <Inline space="space.300" shouldWrap alignBlock="start">
        <Box xcss={cardStyle}>
          <BarChart
            title="Conflicts caught per month"
            data={conflictsByMonth}
            xAccessor="month"
            yAccessor="count"
            height={260}
            width={460}
          />
        </Box>
        {bySource.length ? (
          <Box xcss={cardStyle}>
            <DonutChart
              title="Where decisions are captured"
              data={bySource.map((s) => ({ source: SOURCE_LABEL[s.source] ?? s.source, count: s.count }))}
              colorAccessor="source"
              labelAccessor="source"
              valueAccessor="count"
              height={260}
              width={360}
            />
          </Box>
        ) : null}
      </Inline>

      <Stack space="space.100">
        <Heading size="small">Most-protective decisions</Heading>
        {topDecisions.length ? (
          topDecisions.map((t) => (
            <Text key={t.key}>
              <Strong>{t.key}</Strong> {t.title} — caught {t.total} conflict{t.total === 1 ? '' : 's'}
              {t.dismissed ? ` (${t.dismissed} dismissed)` : ''}
            </Text>
          ))
        ) : (
          <Text size="small">No conflicts yet. Create an issue that contradicts a decision to see this fill up.</Text>
        )}
      </Stack>

      <Stack space="space.100">
        <Heading size="small">Decision hygiene</Heading>
        {hygiene.withoutRationale || hygiene.withoutGuardrails || hygiene.overdueReview || hygiene.needsTuning.length ? (
          <SectionMessage appearance="discovery" title="Keep your decisions useful">
            <Stack space="space.050">
              {hygiene.overdueReview ? <Text>• {hygiene.overdueReview} active decision(s) are past their review date.</Text> : null}
              {hygiene.withoutRationale ? <Text>• {hygiene.withoutRationale} decision(s) have no rationale — future readers won't know why.</Text> : null}
              {hygiene.withoutGuardrails ? <Text>• {hygiene.withoutGuardrails} decision(s) have no guardrails, so they can't catch conflicts.</Text> : null}
              {hygiene.needsTuning.length ? <Text>• Frequently dismissed: {hygiene.needsTuning.join(', ')} — narrow their guardrails.</Text> : null}
            </Stack>
          </SectionMessage>
        ) : (
          <SectionMessage appearance="success" title="All decisions are in good shape">
            <Text>Every active decision has a rationale, guardrails and a current review date.</Text>
          </SectionMessage>
        )}
      </Stack>
    </Stack>
  );
}
