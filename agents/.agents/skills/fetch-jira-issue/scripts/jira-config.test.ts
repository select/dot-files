import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

async function configProcess(home: string, credentials: Record<string, string> = {}) {
	const env: Record<string, string | undefined> = { ...process.env, HOME: home };
	delete env.JIRA_URL;
	delete env.JIRA_USERNAME;
	delete env.JIRA_API_TOKEN;
	const script = `import { loadJiraConfig, getAuthHeader } from ${JSON.stringify(join(import.meta.dir, 'jira-config.ts'))};
const config = await loadJiraConfig();
console.log(JSON.stringify({ config, auth: getAuthHeader(config.username, config.apiToken) }));`;
	const child = Bun.spawn([process.execPath, '-e', script], {
		env: { ...env, ...credentials }, stdout: 'pipe', stderr: 'pipe',
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}

test('prefers complete environment credentials and keeps file fallback', async () => {
	const home = await mkdtemp(join(tmpdir(), 'jira-config-test-'));
	try {
		const configDir = join(home, '.config', 'atlassian-jira');
		await mkdir(configDir, { recursive: true });
		const fileConfig = { jiraUrl: 'https://file.example', username: 'file-user', apiToken: 'file-token' };
		await writeFile(join(configDir, 'credentials.json'), JSON.stringify(fileConfig));
		const env = await configProcess(home, {
			JIRA_URL: 'https://env.example', JIRA_USERNAME: 'env-user', JIRA_API_TOKEN: 'env-token',
		});
		expect(env.code).toBe(0);
		expect(JSON.parse(env.stdout)).toEqual({
			config: { jiraUrl: 'https://env.example', username: 'env-user', apiToken: 'env-token' },
			auth: `Basic ${Buffer.from('env-user:env-token').toString('base64')}`,
		});
		const file = await configProcess(home);
		expect(file.code).toBe(0);
		expect(JSON.parse(file.stdout).config).toEqual(fileConfig);
		const partial = await configProcess(home, { JIRA_USERNAME: 'partial' });
		expect(JSON.parse(partial.stdout).config).toEqual(fileConfig);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test('fails with setup guidance when credentials are missing', async () => {
	const home = await mkdtemp(join(tmpdir(), 'jira-config-test-'));
	try {
		const result = await configProcess(home);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN');
		expect(result.stderr).toContain('credentials.json');
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
