/**
 * 📋 Session History Tools
 * Tools for searching past conversations
 */

export function createSessionHistoryTools(sessionHistory) {
  const searchTool = {
    name: 'session_search',
    description: 'Search past conversations for information discussed earlier. Uses text search across all stored sessions. Great for finding things you discussed hours or days ago that are no longer in working memory.',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The text to search for in past conversations',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default 10, max 50)',
          default: 10,
        },
      },
      required: ['query'],
    },
    async execute({ query, maxResults = 10 }) {
      try {
        const result = await sessionHistory.search(query, { maxResults: Math.min(maxResults, 50) });
        return {
          success: true,
          query,
          totalMatches: result.totalMatches,
          results: result.results.map(r => ({
            date: (r.timestamp || '').split('T')[0],
            time: (r.timestamp || '').split('T')[1] ? (r.timestamp || '').split('T')[1].split('.')[0] : '',
            userMessage: r.userMessage,
            assistantResponse: r.assistantResponse,
            model: r.model,
            toolCalls: r.toolCalls,
          })),
          note: result.truncated ? 'Results were truncated. Try a more specific query.' : undefined,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  return [searchTool];
}