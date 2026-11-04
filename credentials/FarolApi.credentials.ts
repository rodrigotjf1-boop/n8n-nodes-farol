import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class FarolApi implements ICredentialType {
	name = 'farolApi';

	displayName = 'Farol API';

	icon: Icon = { light: 'file:../icons/farol.svg', dark: 'file:../icons/farol.dark.svg' };

	documentationUrl = 'https://github.com/rodrigotjf1-boop/n8n-nodes-farol?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Access Key',
			name: 'accessKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'e.g. dms_ap_farol_...',
			description:
				'The access key that the account management creates in the Farol console. It starts with dms_ap_farol_ and works for one store only.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials?.accessKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.monitorfarol.com.br',
			url: '/v1/integracao/fichas',
			method: 'GET',
		},
	};
}
