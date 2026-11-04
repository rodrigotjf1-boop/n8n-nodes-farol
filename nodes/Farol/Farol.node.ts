import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPairedItemData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://api.monitorfarol.com.br';
const RECIPES_PATH = '/v1/integracao/fichas';

type FullResponse = {
	statusCode: number;
	headers?: IDataObject;
	body: unknown;
};

/** The response body as an object, whether it came parsed or as text. */
function bodyAsObject(body: unknown): IDataObject {
	if (typeof body === 'string') {
		if (body.trim() === '') return {};
		try {
			const parsed: unknown = JSON.parse(body);
			return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as IDataObject)
				: { value: parsed as IDataObject[keyof IDataObject] };
		} catch {
			return { text: body.slice(0, 500) };
		}
	}
	if (body !== null && typeof body === 'object' && !Array.isArray(body)) return body as IDataObject;
	return {};
}

/** The message for an error answer from Farol, by status code. Farol's own text goes in the description. */
function errorMessage(statusCode: number, retryAfter: string | undefined): string {
	if (statusCode === 401) {
		return 'Farol refused the access key. Check that it is correct, active and not expired.';
	}
	if (statusCode === 403) {
		return 'This access key is suspended (90 days without use). Ask the account management to reactivate it in the Farol console: the key stays the same.';
	}
	if (statusCode === 413) {
		return 'The submission is larger than Farol accepts (8 MB).';
	}
	if (statusCode === 429) {
		const wait = retryAfter ? ` Try again in ${retryAfter} seconds.` : '';
		return `Farol limit reached (12 submissions and 60 validations per hour per access key).${wait}`;
	}
	if (statusCode >= 500) {
		return 'Farol is unavailable right now. Try again later.';
	}
	return `Farol rejected the request (HTTP ${statusCode}).`;
}

async function farolRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	itemIndex: number,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${RECIPES_PATH}`,
		headers: { Accept: 'application/json, application/problem+json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (body !== undefined) options.body = body;
	if (qs !== undefined) options.qs = qs;

	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'farolApi',
		options,
	)) as FullResponse;
	const data = bodyAsObject(response.body);
	if (response.statusCode >= 200 && response.statusCode < 300) return data;

	const retryAfterHeader = response.headers?.['retry-after'];
	const retryAfter = typeof retryAfterHeader === 'string' ? retryAfterHeader : undefined;
	// problem+json from Farol: `detail`, with Farol's own `mensagem` kept as an extension member
	const detail =
		typeof data.detail === 'string'
			? data.detail
			: typeof data.mensagem === 'string'
				? data.mensagem
				: undefined;
	throw new NodeApiError(this.getNode(), data as JsonObject, {
		message: errorMessage(response.statusCode, retryAfter),
		description: detail ? `Farol says: ${detail}` : undefined,
		httpCode: String(response.statusCode),
		itemIndex,
	});
}

/** Our own errors go on as they are; anything else is wrapped, so n8n shows it with the node and the item. */
function asNodeError(
	this: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(this.getNode(), error as Error, { itemIndex });
}

/** The list of products from the JSON parameter: a list, or an object with the "produtos" list. */
function productsFromJson(this: IExecuteFunctions, value: unknown): unknown[] {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new NodeOperationError(this.getNode(), "'Products (JSON)' is not valid JSON.", {
				description: "Check the quotes, commas and brackets in 'Products (JSON)'.",
				itemIndex: 0,
			});
		}
	}
	if (Array.isArray(parsed)) return parsed;
	if (parsed !== null && typeof parsed === 'object') {
		const list = (parsed as IDataObject).produtos;
		if (Array.isArray(list)) return list;
	}
	throw new NodeOperationError(
		this.getNode(),
		"'Products (JSON)' is not a list of products.",
		{
			description:
				"Use a list of products, like [{\"nome\": \"X-Burger\"}], or an object with a 'produtos' list.",
			itemIndex: 0,
		},
	);
}

/** Every product is an object with a name. An empty list is refused: it would erase the menu in Farol. */
function checkedProducts(this: IExecuteFunctions, products: unknown[]): IDataObject[] {
	if (products.length === 0) {
		throw new NodeOperationError(this.getNode(), 'There are no products to send.', {
			description:
				'An empty list would erase the whole menu of the store in Farol, so the node does not send it.',
			itemIndex: 0,
		});
	}
	products.forEach((product, index) => {
		const isObject = product !== null && typeof product === 'object' && !Array.isArray(product);
		const name = isObject ? (product as IDataObject).nome : undefined;
		if (typeof name !== 'string' || name.trim() === '') {
			throw new NodeOperationError(this.getNode(), `Product ${index + 1} has no name.`, {
				description: "Add the 'nome' field to the product, with the name as it shows on the order.",
				itemIndex: 0,
			});
		}
	});
	return products as IDataObject[];
}

export class Farol implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Farol',
		name: 'farol',
		icon: { light: 'file:../../icons/farol.svg', dark: 'file:../../icons/farol.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send the recipes of a restaurant to Farol and check the last submission',
		defaults: {
			name: 'Farol',
		},
		// It only becomes an AI tool when someone connects it to an agent. The guards in execute() hold there too: no empty
		// list, every product with a name, one submission per run.
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'farolApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Recipe',
						value: 'recipe',
					},
				],
				default: 'recipe',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['recipe'],
					},
				},
				options: [
					{
						name: 'Get Status',
						value: 'getStatus',
						action: 'Get recipe submission status',
						description:
							'Check the access key and the last recipe submission: the system, the store, when it arrived, how many products and until when the key is valid',
					},
					{
						name: 'Replace All',
						value: 'replaceAll',
						action: 'Replace all recipes in store',
						description:
							'Send the whole menu with its recipes. It replaces every recipe Farol had for the store.',
					},
				],
				default: 'getStatus',
			},
			{
				displayName:
					'Each submission replaces the whole menu of the store in Farol. Send every product in a single run. Farol accepts 12 submissions per hour per access key.',
				name: 'replaceNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						resource: ['recipe'],
						operation: ['replaceAll'],
					},
				},
			},
			{
				displayName: 'Products From',
				name: 'productsFrom',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['recipe'],
						operation: ['replaceAll'],
					},
				},
				options: [
					{
						name: 'Input Items',
						value: 'inputItems',
						description: 'Each input item is one product. All items go together in one submission.',
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'One JSON with the list of products',
					},
				],
				default: 'inputItems',
			},
			{
				displayName: 'Products (JSON)',
				name: 'productsJson',
				type: 'json',
				required: true,
				default: '[]',
				description:
					"A list of products, or an object with a 'produtos' list. The README shows the format of a product.",
				displayOptions: {
					show: {
						resource: ['recipe'],
						operation: ['replaceAll'],
						productsFrom: ['json'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['recipe'],
						operation: ['replaceAll'],
					},
				},
				options: [
					{
						displayName: 'Validate Only',
						name: 'validateOnly',
						type: 'boolean',
						default: false,
						description:
							'Whether to only check the submission, without saving it. Validations have their own limit of 60 per hour.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const returnData: INodeExecutionData[] = [];

		if (operation === 'getStatus') {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					const data = await farolRequest.call(this, 'GET', itemIndex);
					returnData.push({ json: data, pairedItem: { item: itemIndex } });
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: (error as Error).message },
							pairedItem: { item: itemIndex },
						});
						continue;
					}
					throw asNodeError.call(this, error, itemIndex);
				}
			}
			return [returnData];
		}

		if (operation === 'replaceAll') {
			// One submission for the whole run: Farol replaces the menu on every submission.
			const pairedItem: IPairedItemData[] = items.map((_item, itemIndex) => ({ item: itemIndex }));
			try {
				const productsFrom = this.getNodeParameter('productsFrom', 0) as string;
				const options = this.getNodeParameter('options', 0, {}) as IDataObject;
				let products: unknown[];
				if (productsFrom === 'json') {
					if (items.length > 1) {
						throw new NodeOperationError(
							this.getNode(),
							"With 'Products From' set to 'JSON', the node expects a single input item.",
							{
								description:
									"Each submission replaces the whole menu, so the node does not send one per item. To send many products from many items, set 'Products From' to 'Input Items'.",
								itemIndex: 0,
							},
						);
					}
					products = productsFromJson.call(this, this.getNodeParameter('productsJson', 0));
				} else {
					products = items.map((item) => item.json);
				}
				const body: IDataObject = { produtos: checkedProducts.call(this, products) };
				const qs = options.validateOnly === true ? { somente_validar: 'true' } : undefined;
				const data = await farolRequest.call(this, 'PUT', 0, body, qs);
				returnData.push({ json: data, pairedItem });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem });
					return [returnData];
				}
				throw asNodeError.call(this, error, 0);
			}
			return [returnData];
		}

		throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported.`);
	}
}
