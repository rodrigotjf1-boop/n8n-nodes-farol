# n8n-nodes-farol

This is an n8n community node. It lets you use [Farol](https://monitorfarol.com.br) in your n8n workflows.

Farol is a kitchen monitoring service for restaurants, by DMS Tecnologias. It uses the store's recipes (technical sheets)
to know how each product should be put together. With this node, the system that holds the menu (a POS, an ERP, a
spreadsheet) sends the recipes to Farol and checks what Farol has.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation
platform.

- [Installation](#installation)
- [Operations](#operations)
- [Credentials](#credentials)
- [The product format](#the-product-format)
- [What Farol answers](#what-farol-answers)
- [Limits](#limits)
- [Example workflow](#example-workflow)
- [Compatibility](#compatibility)
- [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community
nodes documentation. The package name is `n8n-nodes-farol`.

## Operations

**Recipe**

- **Get Status**: checks the access key and the last submission. It returns the system that sent it, the store, when it
  arrived, how many products came (and how many with a recipe) and until when the key is valid (`vence_em`).
- **Replace All**: sends the whole menu with its recipes. **Each submission replaces everything Farol had for the
  store**: to remove a product, send the list without it.
  - **Products From: Input Items** (default): each input item is one product, and all the items of the run go together
    in a single submission.
  - **Products From: JSON**: one JSON with the list of products (or an object with the `produtos` list). This mode
    expects a single input item.
  - **Options › Validate Only**: Farol checks the submission and saves nothing. Use it while you build the workflow.

The node never sends an empty list (it would erase the menu), and it checks that every product has a name before
sending.

## Credentials

The node uses the **Farol API** credential, with one field: the **Access Key**.

1. In the Farol console, the account management opens **Conexões**, finds the **Outro sistema** card and clicks
   **Criar acesso**.
2. They choose the store and receive the access key, which starts with `dms_ap_farol_`. It is shown only once.
3. In n8n, create a **Farol API** credential and paste the key. n8n tests it against Farol when you save.

Good to know:

- A key works for **one store**. For another store, create another key (and another credential).
- A key is valid for **12 months**. When the management renews it, the old key still works for 7 more days.
- After **90 days without any call**, the key is suspended. The management reactivates it with one click, and the key
  stays the same.
- If the management revokes the key, it stops working at once and the recipes it sent are removed from Farol.
- Treat the key as a password.

## The product format

The field names are the ones of the Farol API, in Portuguese.

```json
{
  "nome": "X-Burger",
  "codigo": "1042",
  "categoria": "Burgers",
  "cozinha": true,
  "ingredientes": [
    { "nome": "Pão brioche", "quantidade": 1, "unidade": "unidade" },
    { "nome": "Blend da casa", "quantidade": 120, "unidade": "g" },
    { "nome": "Queijo prato", "quantidade": 2, "unidade": "fatia" }
  ],
  "variacoes": [
    { "nome": "Simples", "fator": 1 },
    { "nome": "Duplo", "fator": 2 }
  ],
  "adicionais": [
    { "nome": "Bacon", "faz": "acrescenta", "ingrediente": "Bacon fatiado", "quantidade": 20, "unidade": "g" },
    { "nome": "Ponto da carne", "faz": "observacao" }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `nome` | yes | The product name as it shows on the order. It identifies the product and cannot repeat in a submission. |
| `codigo` | no | The product code in your system. |
| `categoria` | no | Only to find the product in lists. |
| `cozinha` | no | `false` for what comes ready, like a canned drink. Without the field, it is `true`. |
| `ingredientes` | if the product has a recipe | The recipe, in the order the product is put together. Each ingredient has `nome`, `quantidade` (greater than zero) and `unidade`: `g`, `kg`, `ml`, `l`, `unidade`, `fatia`, `folha`, `rodela`, `colher` or `pitada`. |
| `variacoes` | if the product has sizes | Each size has `nome` and, optionally, `fator` (how much of the recipe it uses: `2` for a double, `0.5` for half). |
| `adicionais` | if the customer can add or remove | Each one has `nome` and `faz`: `acrescenta` (adds `ingrediente`, with optional `quantidade` and `unidade`), `tira` (removes an `ingrediente` of this recipe) or `observacao` (a note for the kitchen). |
| `combo` | if the product is made of others | A list of `{ "produto": "<nome of another product in the same submission>", "quantidade": 1 }`. |

Farol ignores price, cost, margin and customer data, and any field not described here.

## What Farol answers

**Replace All** returns Farol's answer as the output item:

```json
{
  "resultado": "atualizada",
  "produtos": 2,
  "com_ficha": 1,
  "sem_ficha": ["Refrigerante lata"],
  "de_fora": [],
  "soltos": [],
  "problemas": 0
}
```

- `resultado`: `atualizada` when the store's recipes changed; `nada_mudou` when the submission brings what Farol already
  had.
- `sem_ficha`: products that came without ingredients. This is not an error.
- `de_fora`: products that were **left out**, each with the problems found (`onde` points to the field). A product with
  any problem stays out entirely, and the others go in. **Check `de_fora` after every submission**, for example with an
  IF node.

With **Validate Only** on, the answer has the same fields, with `resultado` set to `so_validado` and `gravado` set to
`false`: Farol checked the submission and saved nothing.

When Farol refuses the whole submission, the node fails with a message in English and, in the description, Farol's own
explanation (in Portuguese). The recipes the store had stay as they were.

## Limits

- **Replace All**: 12 submissions per hour per access key (60 per hour per account). Validations have their own limit of
  60 per hour per key.
- Other calls: 60 per minute per key.
- When a limit is reached, the node fails with the time to wait. Sending the same menu again costs nothing and changes
  nothing.
- A submission can have up to 8 MB.

## Example workflow

1. **Schedule Trigger**: every night.
2. **HTTP Request** (or a database node): reads the menu with the recipes from your system.
3. **Code** or **Edit Fields**: turns each product into the format above (one item per product).
4. **Farol › Recipe › Replace All**, with **Products From: Input Items**.
5. **IF**: `{{ $json.de_fora.length > 0 }}` → send the list to whoever fixes the recipes.

Run it first with **Validate Only** on, look at the answer, then turn it off.

## Compatibility

Built with the n8n node CLI for n8n 1.x and later. Tested against the Farol API version 1.0.0.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Farol](https://monitorfarol.com.br)
- [The Farol API description (OpenAPI 3.1)](https://api.monitorfarol.com.br/.well-known/dms-manifesto)

## License

[MIT](LICENSE.md)
