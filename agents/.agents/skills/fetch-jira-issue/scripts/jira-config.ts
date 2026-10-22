/**
 * Jira configuration loader
 * Reads credentials from environment variables (JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN)
 * or falls back to ~/.config/atlassian-jira/credentials.json
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export interface JiraConfig {
	jiraUrl: string;
	username: string;
	apiToken: string;
}

const CONFIG_PATH = join(homedir(), '.config', 'atlassian-jira', 'credentials.json');

export async function loadJiraConfig(): Promise<JiraConfig> {
	// Prefer environment variables
	const jiraUrl = process.env.JIRA_URL;
	const username = process.env.JIRA_USERNAME;
	const apiToken = process.env.JIRA_API_TOKEN;

	if (jiraUrl && username && apiToken) {
		return { jiraUrl, username, apiToken };
	}

	// Fall back to credentials file
	try {
		const data = await readFile(CONFIG_PATH, 'utf-8');
		return JSON.parse(data);
	} catch (error) {
		console.error('❌ Jira credentials not found');
		console.error('');
		console.error('Provide credentials via environment variables:');
		console.error('  JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN');
		console.error('');
		console.error(`Or create the config file: ${CONFIG_PATH}`);
		console.error('Generate an API token at: https://id.atlassian.com/manage-profile/security/api-tokens');
		process.exit(1);
	}
}

export function getAuthHeader(username: string, apiToken: string): string {
	return `Basic ${Buffer.from(`${username}:${apiToken}`).toString('base64')}`;
}
