/**
 * Entry point for OpenAgent CLI
 * Falls back to parent cli.js since full split is in progress
 */

import { CLI } from '../cli.js';

new CLI().start();
