/**
 * Unit tests for SkillManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillManager, Skill } from '../../src/skills/SkillManager.js';
import fs from '../../src/utils/fs-compat.js';
import path from 'path';
import os from 'os';

describe('SkillManager', () => {
  let manager;
  let testDir;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `openagent-skill-test-${Date.now()}`);
    await fs.ensureDir(testDir);
    manager = new SkillManager({
      workingDir: testDir,
      openAgentDir: path.join(testDir, '.openagent'),
      globalSkillsDir: path.join(testDir, '.openagent-global', 'skills'),
      verbose: false,
    });
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('parseFrontmatter', () => {
    it('should parse YAML frontmatter from content', () => {
      const content = `---
name: test-skill
description: A test skill
version: 1.0.0
tags: [test, demo]
---

# Test Skill

Instructions here.`;

      const { frontmatter, body } = manager.parseFrontmatter(content);
      expect(frontmatter.name).toBe('test-skill');
      expect(frontmatter.description).toBe('A test skill');
      expect(frontmatter.version).toBe('1.0.0');
      expect(frontmatter.tags).toEqual(['test', 'demo']);
      expect(body).toContain('Instructions here');
    });

    it('should return empty frontmatter for content without ---', () => {
      const { frontmatter, body } = manager.parseFrontmatter('Just content');
      expect(frontmatter).toEqual({});
      expect(body).toBe('Just content');
    });

    it('should handle multiline description with >', () => {
      const content = `---
name: test
description: >
  This is a long
  description
---

Body`;

      const { frontmatter } = manager.parseFrontmatter(content);
      expect(frontmatter.description).toContain('This is a long');
    });
  });

  describe('loadSkill', () => {
    it('should load a skill from a directory', async () => {
      const skillDir = path.join(testDir, '.openagent', 'skills', 'my-skill');
      await fs.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: my-skill
description: Does something useful
triggers: [useful, helpful]
---

# My Skill

Do useful things.`
      );

      const skill = await manager.loadSkill(skillDir, 'project');
      expect(skill).not.toBeNull();
      expect(skill.name).toBe('my-skill');
      expect(skill.description).toBe('Does something useful');
      expect(skill.triggers).toEqual(['useful', 'helpful']);
      expect(skill.instructions).toContain('Do useful things');
    });

    it('should return null for directory without SKILL.md', async () => {
      const skillDir = path.join(testDir, 'empty-skill');
      await fs.ensureDir(skillDir);

      const skill = await manager.loadSkill(skillDir);
      expect(skill).toBeNull();
    });

    it('should find reference files', async () => {
      const skillDir = path.join(testDir, 'refs-skill');
      await fs.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: refs\n---\nBody'
      );
      await fs.writeFile(
        path.join(skillDir, 'REFERENCE.md'),
        'Reference content'
      );

      const skill = await manager.loadSkill(skillDir);
      expect(skill.references).toHaveLength(1);
      expect(skill.references[0].name).toBe('REFERENCE.md');
    });

    it('should find scripts', async () => {
      const skillDir = path.join(testDir, 'script-skill');
      await fs.ensureDir(skillDir);
      await fs.ensureDir(path.join(skillDir, 'scripts'));
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: scripted\n---\nBody'
      );
      await fs.writeFile(
        path.join(skillDir, 'scripts', 'run.sh'),
        'echo hello'
      );

      const skill = await manager.loadSkill(skillDir);
      expect(skill.scripts).toHaveLength(1);
      expect(skill.scripts[0].name).toBe('run.sh');
    });
  });

  describe('loadAll', () => {
    it('should discover skills from project directory', async () => {
      const skillsDir = path.join(testDir, '.openagent', 'skills');
      await fs.ensureDir(path.join(skillsDir, 'skill-a'));
      await fs.writeFile(
        path.join(skillsDir, 'skill-a', 'SKILL.md'),
        '---\nname: skill-a\ndescription: First skill\n---\nBody'
      );
      await fs.ensureDir(path.join(skillsDir, 'skill-b'));
      await fs.writeFile(
        path.join(skillsDir, 'skill-b', 'SKILL.md'),
        '---\nname: skill-b\ndescription: Second skill\n---\nBody'
      );

      const skills = await manager.loadAll();
      expect(skills.size).toBe(2);
      expect(skills.has('skill-a')).toBe(true);
      expect(skills.has('skill-b')).toBe(true);
    });

    it('should override global skills with project skills', async () => {
      // Global skill
      const globalDir = path.join(testDir, '.openagent-global', 'skills', 'shared');
      await fs.ensureDir(globalDir);
      await fs.writeFile(
        path.join(globalDir, 'SKILL.md'),
        '---\nname: shared\ndescription: Global version\n---\nGlobal body'
      );

      // Project skill with same name
      const projectDir = path.join(testDir, '.openagent', 'skills', 'shared');
      await fs.ensureDir(projectDir);
      await fs.writeFile(
        path.join(projectDir, 'SKILL.md'),
        '---\nname: shared\ndescription: Project version\n---\nProject body'
      );

      const skills = await manager.loadAll();
      const shared = skills.get('shared');
      expect(shared.description).toBe('Project version');
      expect(shared.source).toBe('project');
    });
  });

  describe('createSkill', () => {
    it('should create a new skill from template', async () => {
      const result = await manager.createSkill('deploy', {
        description: 'Deploy to staging',
        tags: ['deploy', 'staging'],
        triggers: ['deploy', 'ship'],
      });

      expect(result.success).toBe(true);
      expect(await fs.pathExists(path.join(result.path, 'SKILL.md'))).toBe(true);
      expect(await fs.pathExists(path.join(result.path, 'REFERENCE.md'))).toBe(true);
      expect(await fs.pathExists(path.join(result.path, 'scripts'))).toBe(true);
    });

    it('should reject if skill already exists', async () => {
      await manager.createSkill('existing');
      const result = await manager.createSkill('existing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('findMatchingSkills', () => {
    it('should find skills matching query triggers', async () => {
      const skillsDir = path.join(testDir, '.openagent', 'skills');
      await fs.ensureDir(path.join(skillsDir, 'review'));
      await fs.writeFile(
        path.join(skillsDir, 'review', 'SKILL.md'),
        '---\nname: review\ndescription: Code review\ntriggers: [review, audit]\n---\nBody'
      );

      await manager.loadAll();
      const matches = await manager.findMatchingSkills('please review this code');
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe('review');
    });
  });
});

describe('Skill', () => {
  describe('getMetadata', () => {
    it('should return metadata summary', () => {
      const skill = new Skill({
        name: 'test',
        description: 'A test skill',
        version: '2.0.0',
        tags: ['test'],
        triggers: ['testing'],
        source: 'project',
      });

      const meta = skill.getMetadata();
      expect(meta.name).toBe('test');
      expect(meta.description).toBe('A test skill');
      expect(meta.version).toBe('2.0.0');
    });
  });

  describe('matchesTrigger', () => {
    it('should match query against triggers', () => {
      const skill = new Skill({
        triggers: ['review', 'audit', 'quality'],
      });

      expect(skill.matchesTrigger('please review my code')).toBe(true);
      expect(skill.matchesTrigger('run an audit')).toBe(true);
      expect(skill.matchesTrigger('check quality')).toBe(true);
      expect(skill.matchesTrigger('deploy the app')).toBe(false);
    });

    it('should be case insensitive', () => {
      const skill = new Skill({ triggers: ['Review'] });
      expect(skill.matchesTrigger('REVIEW this')).toBe(true);
    });
  });
});
