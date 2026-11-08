import api from '@forge/api';

/**
 * Teamwork Graph integration (Forge Preview API).
 *
 * We use the graph to answer "who stands behind this decision?": the teams the
 * decision owner belongs to. This turns an anonymous rule into an accountable
 * one — conflicts can be routed to the right team, not just a person who may
 * have moved on.
 *
 * The API is in Preview and requires the app to be allowlisted. Every call is
 * best-effort: failures degrade to `{ available: false }` and never break the
 * core product.
 */

const QUERY = `
  query decisionMemoryOwnerTeams($cypher: String!, $params: CypherRequestParams) {
    cypherQuery(query: $cypher, params: $params) {
      edges {
        node {
          columns {
            key
            value {
              __typename
              ... on CypherQueryResultListNode {
                nodes { data { __typename ... on AtlassianTeam { id displayName } } }
              }
            }
          }
        }
      }
    }
  }`;

const CYPHER = `MATCH (u:AtlassianUser {ari: $ari})-[:atlassian_user_is_in_atlassian_team]->(t:AtlassianTeam)
RETURN collect(distinct t) AS teams`;

const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;

/** Pure: pull team objects out of the cypherQuery response. Exported for tests. */
export function parseTeams(body) {
  const teams = [];
  for (const edge of body?.data?.cypherQuery?.edges ?? []) {
    for (const column of edge?.node?.columns ?? []) {
      for (const node of column?.value?.nodes ?? []) {
        const t = node?.data;
        if (t?.id && t?.displayName && !teams.some((x) => x.id === t.id)) {
          teams.push({ id: t.id, name: t.displayName });
        }
      }
    }
  }
  return teams;
}

/**
 * @returns {Promise<{available: boolean, teams: Array<{id: string, name: string}>, error?: string}>}
 */
export async function getOwnerTeams(accountId) {
  if (!accountId) return { available: false, teams: [] };
  try {
    const res = await api.asUser().requestTeamworkGraph(QUERY, {
      cypher: CYPHER,
      params: { ari: userAri(accountId) },
    });
    const body = await res.json();
    if (body?.errors?.length) {
      return { available: false, teams: [], error: String(body.errors[0]?.message ?? 'graph error').slice(0, 200) };
    }
    return { available: true, teams: parseTeams(body) };
  } catch (err) {
    console.warn('Teamwork Graph unavailable', err?.message);
    return { available: false, teams: [], error: 'Teamwork Graph unavailable' };
  }
}
