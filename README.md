# 交易解释器最小 Demo

这个 demo 对应 AI x Web3 School 的 LLM 最小实践：输入交易哈希，读取交易详情、事件日志和相关 ABI，再生成一段解释。重点不是文案漂亮，而是把链上事实、ABI 解码、模型推断、来源边界和不确定性分开。

## 如何运行

直接用浏览器打开 `index.html` 即可。页面支持两种模式：

- 输入真实 Ethereum Mainnet 交易哈希：尝试通过公共 RPC 查询交易、receipt、logs，通过 `eth_call` 查询 token metadata，通过 Sourcify 查询 ABI，通过 OpenChain / 4byte 查询函数签名。
- 点击“载入样例”：使用内置样例数据，适合离线学习完整流程。

页面内置的样例交易：

```text
0x7b8f4b5c3f9e2a1d6e0c6f3a9b0d7e8f2c4a1b9d8e7f6c5b4a39281726354455
```

## Demo 结构

- `index.html`：最小页面结构，包含交易输入、解释结果、链上事实、LLM 上下文三个视图。
- `styles.css`：页面样式，用颜色区分链上事实、ABI/规则、模型推断和不确定性。
- `app.js`：内置样例数据、确定性解析、LLM 上下文构造、模拟 LLM 输出。

## 与原文原则的对应

- 把模型当推理层，不当真相源：`deriveChainFacts()` 先从交易、receipt logs 和 ABI 中解析事实，`simulateLlmExplanation()` 只基于这些事实生成解释。
- 把输出变成可检查对象：页面提供“链上事实”和“LLM 上下文”两个 tab，可以检查模型到底看到了什么。
- 把不确定性前移暴露：解释里单独列出价格、路由、手续费、MEV、地址标签来源等不确定项。

## 真实查询的边界

这个 demo 不需要 API key，但公共服务会有稳定性和 CORS 限制。真实查询能确定的内容包括：

- `eth_getTransactionByHash` 返回的交易 from、to、value、input。
- `eth_getTransactionReceipt` 返回的 status、gasUsed、logs。
- ERC-20 `Transfer` 事件的 from、to、amount。
- token `symbol`、`decimals`、`name`，如果合约支持这些标准方法。

真实查询不能保证的内容包括：

- 完整 calldata 参数解码，因为很多合约 ABI 未公开或无法从 Sourcify 找到。
- 价格是否合理、路由是否最优、是否存在 MEV。
- 地址标签一定正确，除非你接入可信标签库并记录来源。

## 替换成生产数据源

生产版本建议把公共 endpoint 替换成自己的 RPC、索引器、ABI 服务和 LLM API：

```js
async function fetchTransactionBundle(txHash) {
  const tx = await rpc.getTransaction(txHash);
  const receipt = await rpc.getTransactionReceipt(txHash);
  const abis = await abiService.lookup([tx.to, ...receipt.logs.map((log) => log.address)]);
  return { tx, receipt, abis };
}
```

然后用真实 LLM API 替换 `simulateLlmExplanation()`。建议要求模型输出 JSON schema，并保留每条结论的 `source`、`confidence` 和 `uncertainty` 字段。
