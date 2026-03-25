/**
 * 📝 OpenAgent Markdown Renderer
 * Renders markdown content with syntax highlighting and terminal-friendly formatting
 */

import React from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from './Theme.js';

/**
 * Markdown Renderer Component
 * @param {Object} props
 * @param {Object} props.theme - Theme colors object
 * @param {string} props.content - Markdown content to render
 */
const MarkdownRenderer = ({
  theme = ThemeColors,
  content = '',
}) => {
  // Split content into lines for processing
  const lines = content.split('\n');
  
  // Parse markdown line by line
  const renderMarkdown = () => {
    const elements = [];
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i];
      
      // Empty line
      if (line.trim() === '') {
        i++;
        continue;
      }
      
      // Heading
      if (line.startsWith('#')) {
        const headingMatch = line.match(/^(#+)\s*(.*)/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const text = headingMatch[2];
          const headingColor = level === 1 ? theme.primary : 
                              level === 2 ? theme.secondary : theme.text;
          const headingSize = level === 1 ? 'bold' : 
                             level === 2 ? 'bold' : 'normal';
          
          elements.push(
            <Box key={`heading-${i}`} marginY={1}>
              <Text color={headingColor} bold={headingSize === 'bold'}>
                {text}
              </Text>
            </Box>
          );
          i++;
          continue;
        }
      }
      
      // Code block (fenced)
      if (line.startsWith('```')) {
        const language = line.slice(3).trim() || 'plaintext';
        const codeLines = [];
        i++;
        
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // Skip closing ```
        
        elements.push(
          <Box key={`code-${i}`} flexDirection="column" marginY={1}>
            <Box
              backgroundColor={theme.codeBackground}
              borderColor={theme.codeBorder}
              borderStyle="round"
              paddingX={1}
            >
              <Text color={theme.textMuted}>{language}</Text>
            </Box>
            <Box
              backgroundColor={theme.backgroundSecondary}
              borderColor={theme.codeBorder}
              borderStyle="round"
              paddingX={1}
              paddingY={1}
            >
              <Text color={theme.syntaxKeyword}>
                {codeLines.join('\n')}
              </Text>
            </Box>
          </Box>
        );
        continue;
      }
      
      // Blockquote
      if (line.startsWith('>')) {
        const quoteText = line.slice(1).trim();
        elements.push(
          <Box key={`quote-${i}`} marginLeft={2} marginY={1}>
            <Text color={theme.textDim}>
              {quoteText}
            </Text>
          </Box>
        );
        i++;
        continue;
      }
      
      // Unordered list
      if (line.startsWith('-') || line.startsWith('*') || line.startsWith('+')) {
        const listItems = [];
        while (i < lines.length && (lines[i].startsWith('-') || lines[i].startsWith('*') || lines[i].startsWith('+'))) {
          const itemText = lines[i].slice(1).trim();
          listItems.push(
            <Text key={`list-item-${i}`} color={theme.text}>
              • {itemText}
            </Text>
          );
          i++;
        }
        
        elements.push(
          <Box key={`list-${i}`} flexDirection="column" marginLeft={2} marginY={1}>
            {listItems}
          </Box>
        );
        continue;
      }
      
      // Ordered list
      if (line.match(/^\d+\.\s/)) {
        const listItems = [];
        let counter = 1;
        while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
          const itemText = lines[i].replace(/^\d+\.\s/, '');
          listItems.push(
            <Text key={`olist-item-${i}`} color={theme.text}>
              {counter}. {itemText}
            </Text>
          );
          counter++;
          i++;
        }
        
        elements.push(
          <Box key={`olist-${i}`} flexDirection="column" marginLeft={2} marginY={1}>
            {listItems}
          </Box>
        );
        continue;
      }
      
      // Table
      if (line.includes('|')) {
        const tableRows = [];
        const separatorIndex = lines.findIndex(l => l.match(/^\|[-\s|]+\|$/));
        
        if (separatorIndex !== -1) {
          // Parse header
          const headers = lines[separatorIndex - 1].split('|').filter(cell => cell.trim()).map(cell => cell.trim());
          // Parse rows
          for (let j = separatorIndex + 1; j < lines.length && lines[j].includes('|'); j++) {
            const cells = lines[j].split('|').filter(cell => cell.trim()).map(cell => cell.trim());
            tableRows.push(cells);
          }
          
          // Render table (simple text representation)
          elements.push(
            <Box key={`table-${i}`} flexDirection="column" marginY={1}>
              {headers.map((header, idx) => (
                <Text key={`header-${idx}`} color={theme.primary} bold>
                  {header}
                </Text>
              ))}
              {tableRows.map((row, rowIdx) => (
                <Text key={`row-${rowIdx}`} color={theme.text}>
                  {row.join(' | ')}
                </Text>
              ))}
            </Box>
          );
          
          // Skip processed lines
          i = separatorIndex + 1 + tableRows.length;
          continue;
        }
      }
      
      // Inline formatting: bold, italic, strikethrough, links
      const formatText = (text) => {
        // Bold (**text** or __text__)
        text = text.replace(/\*\*(.*?)\*\*/g, (_, match) => `**${match}**`);
        // Italic (*text* or _text_)
        text = text.replace(/\*(.*?)\*/g, (_, match) => `*${match}*`);
        // Strikethrough (~~text~~)
        text = text.replace(/~~(.*?)~~/g, (_, match) => `~~${match}~~`);
        // Links [text](url)
        text = text.replace(/\[(.*?)\]\((.*?)\)/g, (_, text, url) => `[${text}](${url})`);
        
        return text;
      };
      
      // Regular paragraph
      elements.push(
        <Box key={`para-${i}`} marginY={1}>
          <Text color={theme.text}>
            {formatText(line)}
          </Text>
        </Box>
      );
      i++;
    }
    
    return elements;
  };
  
  return (
    <Box flexDirection="column" width="100%">
      {renderMarkdown()}
    </Box>
  );
};

export default MarkdownRenderer;
