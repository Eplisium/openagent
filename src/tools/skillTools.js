/**
 * 🎯 Skill Tools
 * Tools for the agent to interact with the skill system
 */

/**
 * Create skill tools for the agent
 * @param {import('../skills/SkillManager.js').SkillManager} skillManager
 * @returns {Array} Tool definitions
 */
export function createSkillTools(skillManager) {
  const listSkillsTool = {
    name: 'list_skills',
    description: 'List all available skills. Shows skill names, descriptions, and capabilities.',
    category: 'skill',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      try {
        const skills = await skillManager.listSkills();
        return {
          success: true,
          skills,
          count: skills.length,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const useSkillTool = {
    name: 'use_skill',
    description: 'Activate a skill to load its instructions into context. Skills provide domain-specific guidance for complex tasks.',
    category: 'skill',
    parameters: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'The name of the skill to activate',
        },
        action: {
          type: 'string',
          description: 'Action: "load" for instructions, "list" for all skills, "scripts" for available scripts',
          enum: ['load', 'list', 'scripts'],
          default: 'load',
        },
      },
      required: ['skill'],
    },
    async execute({ skill, action = 'load' }) {
      try {
        return await skillManager.executeSkillAction(skill, action);
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const createSkillTool = {
    name: 'create_skill',
    description: 'Create a new skill from a template. Skills are stored in .openagent/skills/<name>/',
    category: 'skill',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (lowercase, hyphenated)',
        },
        description: {
          type: 'string',
          description: 'What this skill does',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords that should trigger this skill',
        },
      },
      required: ['name', 'description'],
    },
    async execute({ name, description, tags = [], triggers = [] }) {
      try {
        return await skillManager.createSkill(name, { description, tags, triggers });
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  return [listSkillsTool, useSkillTool, createSkillTool];
}
