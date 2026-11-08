import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  DatePicker,
  ErrorMessage,
  HelperMessage,
  Inline,
  Label,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  SectionMessage,
  Stack,
  Strong,
  Tag,
  TagGroup,
  Text,
  TextArea,
  Textfield,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

/** Call a resolver and unwrap `{ ok, data, error }`. Throws Error(userMessage) on failure. */
export async function call(name, payload = {}) {
  const res = await invoke(name, payload);
  if (!res?.ok) throw new Error(res?.error ?? 'Something went wrong.');
  return res.data;
}

/** Load data from a resolver with loading / error / reload state. */
export function useResolver(name, payload, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const latest = useRef(0);
  const load = useCallback(async () => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await call(name, payload);
      if (id === latest.current) setState({ loading: false, data, error: null });
    } catch (e) {
      if (id === latest.current) setState({ loading: false, data: null, error: e.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

export const cardStyle = xcss({
  padding: 'space.150',
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  backgroundColor: 'elevation.surface',
});

export const statStyle = xcss({
  padding: 'space.150',
  borderRadius: 'border.radius.200',
  backgroundColor: 'color.background.neutral',
  minWidth: '140px',
});

const STATUS_APPEARANCE = { active: 'success', superseded: 'moved', revoked: 'removed' };

export function StatusLozenge({ status }) {
  return <Lozenge appearance={STATUS_APPEARANCE[status] ?? 'default'}>{status}</Lozenge>;
}

export function GuardrailTags({ avoid = [], prefer = [] }) {
  if (!avoid.length && !prefer.length) return <Text size="small">No guardrails detected.</Text>;
  return (
    <Stack space="space.050">
      {prefer.length ? (
        <Inline space="space.050" alignBlock="center" shouldWrap>
          <Text size="small">Prefer:</Text>
          <TagGroup>
            {prefer.map((t) => (
              <Tag key={`p-${t}`} text={t} color="greenLight" />
            ))}
          </TagGroup>
        </Inline>
      ) : null}
      {avoid.length ? (
        <Inline space="space.050" alignBlock="center" shouldWrap>
          <Text size="small">Avoid:</Text>
          <TagGroup>
            {avoid.map((t) => (
              <Tag key={`a-${t}`} text={t} color="redLight" />
            ))}
          </TagGroup>
        </Inline>
      ) : null}
    </Stack>
  );
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <SectionMessage appearance="error" title="Decision Memory">
      <Stack space="space.100">
        <Text>{error}</Text>
        {onRetry ? (
          <Inline>
            <Button onClick={onRetry}>Try again</Button>
          </Inline>
        ) : null}
      </Stack>
    </SectionMessage>
  );
}

export const shortDate = (iso) => (iso ? String(iso).slice(0, 10) : '—');

/**
 * Create / supersede form with live guardrail preview so users see exactly
 * what Decision Memory will watch for.
 */
export function DecisionFormModal({ mode = 'create', supersedes, showScope = false, onClose, onSaved }) {
  const [statement, setStatement] = useState('');
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [tags, setTags] = useState(supersedes?.tags?.join(', ') ?? '');
  const [avoidTerms, setAvoidTerms] = useState('');
  const [preferTerms, setPreferTerms] = useState('');
  const [reviewBy, setReviewBy] = useState('');
  const [projectOnly, setProjectOnly] = useState(false);
  const [preview, setPreview] = useState({ avoid: [], prefer: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (statement.trim().length < 8) {
      setPreview({ avoid: [], prefer: [] });
      return undefined;
    }
    const t = setTimeout(() => {
      call('previewGuardrails', { statement }).then(setPreview).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [statement]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const base = { statement, title, rationale, tags, avoidTerms, preferTerms, reviewBy };
      const result =
        mode === 'supersede'
          ? await call('supersedeDecision', { ...base, key: supersedes.key })
          : await call('recordDecision', { ...base, scope: projectOnly ? 'project' : 'site' });
      onSaved(result);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const merged = {
    avoid: [...new Set([...splitList(avoidTerms), ...preview.avoid])],
    prefer: [...new Set([...splitList(preferTerms), ...preview.prefer])],
  };

  return (
    <Modal onClose={onClose} width="large">
      <ModalHeader>
        <ModalTitle>{mode === 'supersede' ? `Supersede ${supersedes.key}` : 'Record a decision'}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.150">
          {mode === 'supersede' ? (
            <SectionMessage appearance="information">
              <Text>
                Replacing: {supersedes.title}. The old decision stays in history, marked superseded.
              </Text>
            </SectionMessage>
          ) : null}
          <Box>
            <Label labelFor="dm-statement">Decision (required)</Label>
            <TextArea
              id="dm-statement"
              value={statement}
              placeholder="Use PostgreSQL instead of MongoDB for all new services."
              onChange={(e) => setStatement(e.target.value)}
            />
            <HelperMessage>Write one checkable rule. Decision Memory flags future work that contradicts it.</HelperMessage>
          </Box>
          <Box>
            <Label labelFor="dm-title">Short title</Label>
            <Textfield id="dm-title" value={title} placeholder="Defaults to the first sentence" onChange={(e) => setTitle(e.target.value)} />
          </Box>
          <Box>
            <Label labelFor="dm-rationale">Why? (rationale, alternatives, constraints)</Label>
            <TextArea id="dm-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </Box>
          <Box xcss={cardStyle}>
            <Stack space="space.100">
              <Text>
                <Strong>Guardrails</Strong> (what new work is checked against)
              </Text>
              <GuardrailTags avoid={merged.avoid} prefer={merged.prefer} />
              <Inline space="space.150" shouldWrap>
                <Box>
                  <Label labelFor="dm-avoid">Also avoid (comma-separated)</Label>
                  <Textfield id="dm-avoid" value={avoidTerms} onChange={(e) => setAvoidTerms(e.target.value)} />
                </Box>
                <Box>
                  <Label labelFor="dm-prefer">Also prefer (comma-separated)</Label>
                  <Textfield id="dm-prefer" value={preferTerms} onChange={(e) => setPreferTerms(e.target.value)} />
                </Box>
              </Inline>
            </Stack>
          </Box>
          <Inline space="space.150" shouldWrap>
            <Box>
              <Label labelFor="dm-tags">Tags</Label>
              <Textfield id="dm-tags" value={tags} placeholder="database, backend" onChange={(e) => setTags(e.target.value)} />
            </Box>
            <Box>
              <Label labelFor="dm-review">Revisit by</Label>
              <DatePicker id="dm-review" value={reviewBy} onChange={(v) => setReviewBy(v ?? '')} />
            </Box>
          </Inline>
          {showScope ? (
            <Checkbox
              label="Only visible to people who can see this issue's project"
              isChecked={projectOnly}
              onChange={(e) => setProjectOnly(e.target.checked)}
            />
          ) : null}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={submit} isDisabled={saving || statement.trim().length < 8}>
          {saving ? 'Saving…' : mode === 'supersede' ? 'Supersede' : 'Record decision'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function splitList(s) {
  return String(s ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}
