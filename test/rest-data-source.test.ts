import {ApolloError, AuthenticationError, ForbiddenError} from 'apollo-server-errors';
import test from 'ava';
import { TimeoutError } from 'got';
import nock from 'nock';
import {RESTDataSource} from '../src';

test.serial('Should be able to make a simple GET call', async (t) => {
	const baseURL = 'https://api.example.com';
	const path = '/foo';
	const scope = nock(baseURL).get(path).reply(200, {name: 'foo'});

	const dataSource = new (class extends RESTDataSource {
		baseURL = baseURL;

		async getFoo() {
			return this.get(path);
		}
	})();

	const response = await dataSource.getFoo();

	t.is(scope.isDone(), true);
	t.deepEqual(response.body, {name: 'foo'});
});

test.serial('Should error with ApolloError', async (t) => {
	const baseURL = 'https://api.example.com';
	const path = '/foo';
	const scope = nock(baseURL).get(path).reply(400);

	const dataSource = new (class extends RESTDataSource {
		baseURL = baseURL;

		async getFoo() {
			return this.get(path);
		}
	})();

	await t.throwsAsync(
		dataSource.getFoo(),
		{instanceOf: ApolloError, message: 'Response code 400 (Bad Request)'},
		'Bad request'
	);
	t.is(scope.isDone(), true);
});

test.serial('Should error with AuthenticationError', async (t) => {
	const baseURL = 'https://api.example.com';
	const path = '/foo';
	const scope = nock(baseURL).get(path).reply(401);

	const dataSource = new (class extends RESTDataSource {
		baseURL = baseURL;

		async getFoo() {
			return this.get(path);
		}
	})();

	await t.throwsAsync(
		dataSource.getFoo(),
		{
			instanceOf: AuthenticationError,
			message: 'Response code 401 (Unauthorized)'
		},
		'Unauthenticated'
	);
	t.is(scope.isDone(), true);
});

test.serial('Should error with ForbiddenError', async (t) => {
	const baseURL = 'https://api.example.com';
	const path = '/foo';
	const scope = nock(baseURL).get(path).reply(403);

	const dataSource = new (class extends RESTDataSource {
		baseURL = baseURL;

		async getFoo() {
			return this.get(path);
		}
	})();

	await t.throwsAsync(
		dataSource.getFoo(),
		{
			instanceOf: ForbiddenError,
			message: 'Response code 403 (Forbidden)'
		},
		'Unauthenticated'
	);
	t.is(scope.isDone(), true);
});

test.serial('Should cache subsequent GET calls to the same endpoint', async (t) => {
	const baseURL = 'https://api.example.com';
	const path = '/foo';
	const scope = nock(baseURL).get(path).times(1).reply(200, {name: 'foo'});

	const dataSource = new (class extends RESTDataSource {
		baseURL = baseURL;

		async getFoo() {
			return this.get(path);
		}
	})();

	let response = await dataSource.getFoo();
	t.deepEqual(response.body, {name: 'foo'});

	response = await dataSource.getFoo();
	t.deepEqual(response.body, {name: 'foo'});

	t.is(scope.isDone(), true);
});

test.serial('Should timeout', async (t) => {
	const baseURL = 'https://api.example.com';
	const path = '/foo';
	const scope = nock(baseURL).get(path).delay(300).reply(200, {name: 'foo'});

	const dataSource = new (class extends RESTDataSource {
		baseURL = baseURL;

		constructor() {
			super({
				timeout: 100
			})
		}

		async getFoo() {
			return this.get(path);
		}
	})();

	await t.throwsAsync(
		dataSource.getFoo(),
		{
			instanceOf: TimeoutError,
			message: 'Timeout awaiting \'request\' for 100ms'
		},
		'Timeout'
	);

	t.is(scope.isDone(), true);
});