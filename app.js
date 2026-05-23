const SAMPLE_HASH =
  "0x7b8f4b5c3f9e2a1d6e0c6f3a9b0d7e8f2c4a1b9d8e7f6c5b4a39281726354455";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const networks = {
  ethereum: {
    name: "Ethereum Mainnet",
    chainId: 1,
    nativeSymbol: "ETH",
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://rpc.flashbots.net", "https://cloudflare-eth.com"],
  },
};

const fixtures = {
  [SAMPLE_HASH]: {
    network: "Ethereum Mainnet",
    transaction: {
      hash: SAMPLE_HASH,
      from: "0x8b3f3a12d62c5a67d9f19b8a78e8b7d5c44f2f91",
      to: "0x1111111254eeb25477b68fb85ed929f73a960582",
      valueEth: "0",
      status: "success",
      blockNumber: 19876543,
      timestamp: "2026-05-21T08:12:44Z",
      method: "swapExactTokensForTokens",
      decodedInput: {
        amountIn: "2500000000",
        amountOutMin: "728000000000000000",
        path: [
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        ],
        recipient: "0x8b3f3a12d62c5a67d9f19b8a78e8b7d5c44f2f91",
      },
    },
    contracts: {
      "0x1111111254eeb25477b68fb85ed929f73a960582": {
        label: "1inch Aggregation Router",
        abi: [
          "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address recipient)",
        ],
      },
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": {
        label: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        abi: ["event Transfer(address indexed from,address indexed to,uint256 value)"],
      },
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": {
        label: "Wrapped Ether",
        symbol: "WETH",
        decimals: 18,
        abi: ["event Transfer(address indexed from,address indexed to,uint256 value)"],
      },
    },
    logs: [
      {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        event: "Transfer",
        args: {
          from: "0x8b3f3a12d62c5a67d9f19b8a78e8b7d5c44f2f91",
          to: "0x1111111254eeb25477b68fb85ed929f73a960582",
          value: "2500000000",
        },
      },
      {
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        event: "Transfer",
        args: {
          from: "0x1111111254eeb25477b68fb85ed929f73a960582",
          to: "0x8b3f3a12d62c5a67d9f19b8a78e8b7d5c44f2f91",
          value: "742631880000000000",
        },
      },
    ],
  },
};

function setStatus(message) {
  document.querySelector("#status").textContent = message;
}

function formatUnits(value, decimals) {
  const raw = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const integer = raw / scale;
  const fraction = raw % scale;
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionText ? `${integer}.${fractionText}` : integer.toString();
}

function formatWei(hexValue) {
  return formatUnits(hexToBigInt(hexValue).toString(), 18);
}

function hexToBigInt(hexValue) {
  if (!hexValue || hexValue === "0x") return 0n;
  return BigInt(hexValue);
}

function hexToNumber(hexValue) {
  return Number(hexToBigInt(hexValue));
}

function shortAddress(address) {
  if (!address) return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTransactionStatus(status) {
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  return status || "未知";
}

function getContract(fixture, address) {
  return fixture.contracts[address] || { label: "Unknown Contract", symbol: "UNKNOWN", decimals: 18 };
}

function deriveChainFacts(fixture) {
  const transfers = fixture.logs
    .filter((log) => log.event === "Transfer")
    .map((log) => {
      const token = getContract(fixture, log.address);
      return {
        tokenAddress: log.address,
        tokenLabel: token.label,
        symbol: token.symbol,
        from: log.args.from,
        to: log.args.to,
        rawValue: log.args.value,
        amount: formatUnits(log.args.value, token.decimals),
        source: "receipt.logs + token ABI Transfer event",
      };
    });

  return {
    network: fixture.network,
    transaction: fixture.transaction,
    router: getContract(fixture, fixture.transaction.to),
    transfers,
    decodedBy: {
      input: "router ABI function signature",
      logs: "ERC-20 Transfer event ABI",
      tokenAmounts: "token decimals metadata",
    },
  };
}

function buildLlmContext(facts) {
  return {
    task: "Explain this transaction for a wallet user. Separate chain facts from model inference.",
    requiredOutput: [
      "用户发起了什么动作",
      "涉及哪些资产和地址",
      "哪些信息来自链上数据，哪些是模型推断",
      "模型不确定的地方",
      "如果要签类似交易，用户应该检查什么",
    ],
    chainFacts: facts,
    constraints: [
      "Do not invent protocols, prices, or user intent that are not present in chain facts.",
      "Mark uncertainty explicitly.",
      "Use source labels for each important claim.",
    ],
  };
}

function simulateLlmExplanation(facts) {
  const tx = facts.transaction;
  const transfers = facts.transfers || [];
  const outgoing = transfers.find((transfer) => transfer.from.toLowerCase() === tx.from.toLowerCase());
  const incoming = transfers.find((transfer) => transfer.to.toLowerCase() === tx.from.toLowerCase());
  const nativeValue = tx.valueEth && tx.valueEth !== "0" ? `${tx.valueEth} ${facts.nativeSymbol || "ETH"}` : null;
  const methodText = tx.method || facts.input?.methodCandidates?.[0] || facts.input?.selector || "未知方法";
  const actionText =
    outgoing && incoming
      ? `用户地址 ${shortAddress(tx.from)} 调用了 ${facts.router.label} 的 ${methodText}，看起来是在用 ${outgoing.amount} ${outgoing.symbol} 兑换约 ${incoming.amount} ${incoming.symbol}。`
      : nativeValue
        ? `用户地址 ${shortAddress(tx.from)} 向 ${shortAddress(tx.to)} 发起交易，并转出 ${nativeValue}。`
        : `用户地址 ${shortAddress(tx.from)} 调用了 ${facts.router.label}，但仅凭当前解码结果无法确定完整业务动作。`;

  return {
    action: {
      text: actionText,
      source: "模型基于交易 input、合约标签/ABI、Transfer 事件和 native value 做出的动作归纳",
    },
    assetsAndAddresses: [
      {
        role: "交易是否成功",
        value: formatTransactionStatus(tx.status),
        source: "transaction receipt status",
      },
      {
        role: "发起地址",
        value: tx.from,
        source: "transaction.from",
      },
      {
        role: "接收地址",
        value: tx.decodedInput?.recipient || "未解码，无法确认最终接收地址",
        source: tx.decodedInput?.recipient ? "decoded input recipient" : "当前 ABI / input 解码不足",
      },
      {
        role: "交互合约",
        value: `${tx.to} (${facts.router.label})`,
        source: "transaction.to + ABI/标签",
      },
      ...transfers.map((transfer) => ({
        role:
          transfer.from.toLowerCase() === tx.from.toLowerCase()
            ? "转出资产"
            : transfer.to.toLowerCase() === tx.from.toLowerCase()
              ? "转入资产"
              : "相关 Transfer",
        value: `${transfer.amount} ${transfer.symbol} (${transfer.tokenAddress})`,
        source: transfer.source,
      })),
      ...(nativeValue
        ? [
            {
              role: "原生资产转账",
              value: nativeValue,
              source: "transaction.value",
            },
          ]
        : []),
    ],
    boundaries: [
      "链上数据能证明：交易状态、调用目标、from/to/value、receipt logs 和可解码事件。",
      "模型推断的是：这些底层变化对应的用户动作，例如 swap、转账、授权或合约调用。",
      "ABI/元数据提供的是：函数候选名、事件名、token symbol 和 decimals；如果元数据缺失，解释必须降级。",
    ],
    uncertainty: [
      ...(facts.input?.methodCandidates?.length > 1
        ? ["函数签名库可能返回多个候选，需要结合 ABI 或 calldata 参数进一步确认。"]
        : []),
      ...(facts.abi?.routerAbiFound ? [] : ["没有找到目标合约的 Sourcify ABI，因此无法完整解码函数参数。"]),
      "没有接入价格预言机或 DEX 路由细节，无法判断成交价格是否合理。",
      "Transfer 事件不能完整代表所有内部调用、手续费、MEV 或协议层状态变化。",
      "地址标签和 token metadata 可能来自合约自身或公共仓库，真实系统要记录来源和更新时间。",
    ],
    signingChecklist: [
      "确认交互合约地址是否为预期协议，避免签给仿冒合约。",
      "检查授权额度、花费资产、最小收到数量 amountOutMin、接收地址和截止时间。",
      "比较钱包模拟结果与前端展示结果，重点看会转出哪些资产、会收到哪些资产。",
      "对高价值交易，检查滑点、价格影响、手续费和是否存在未知合约调用。",
    ],
  };
}

async function rpc(network, method, params) {
  const payload = { jsonrpc: "2.0", id: Date.now(), method, params };
  let lastError;

  for (const rpcUrl of network.rpcUrls) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || "RPC error");
      return data.result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("All RPC endpoints failed");
}

function topicToAddress(topic) {
  return `0x${topic.slice(-40)}`;
}

function normalizeAddress(address) {
  return address ? address.toLowerCase() : address;
}

function decodeAbiString(result) {
  if (!result || result === "0x") return null;
  const hex = result.slice(2);

  const decodeBytes32 = () => {
    const bytes32 = hex.slice(0, 64);
    const bytes = bytes32.match(/.{1,2}/g).map((part) => parseInt(part, 16)).filter(Boolean);
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0/g, "").trim() || null;
  };

  try {
    const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
    const lengthStart = offset * 2;
    const length = Number(BigInt(`0x${hex.slice(lengthStart, lengthStart + 64)}`));
    const valueHex = hex.slice(lengthStart + 64, lengthStart + 64 + length * 2);
    if (valueHex) {
      const bytes = valueHex.match(/.{1,2}/g).map((part) => parseInt(part, 16));
      return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0/g, "").trim();
    }
  } catch (error) {
    return decodeBytes32();
  }

  return decodeBytes32();
}

async function ethCall(network, to, data) {
  return rpc(network, "eth_call", [{ to, data }, "latest"]);
}

async function fetchTokenMetadata(network, address) {
  const [symbolResult, decimalsResult, nameResult] = await Promise.allSettled([
    ethCall(network, address, "0x95d89b41"),
    ethCall(network, address, "0x313ce567"),
    ethCall(network, address, "0x06fdde03"),
  ]);

  const symbol = symbolResult.status === "fulfilled" ? decodeAbiString(symbolResult.value) : null;
  const name = nameResult.status === "fulfilled" ? decodeAbiString(nameResult.value) : null;
  const decimals =
    decimalsResult.status === "fulfilled" && decimalsResult.value !== "0x"
      ? Number(hexToBigInt(decimalsResult.value))
      : 18;

  return {
    label: name || symbol || "Unknown Token",
    symbol: symbol || "UNKNOWN",
    decimals: Number.isFinite(decimals) ? decimals : 18,
    source: "eth_call token metadata",
  };
}

async function fetchSourcifyMetadata(chainId, address) {
  const checksumless = address.toLowerCase();
  const urls = [
    `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=metadata`,
    `https://repo.sourcify.dev/contracts/full_match/${chainId}/${checksumless}/metadata.json`,
    `https://repo.sourcify.dev/contracts/partial_match/${chainId}/${checksumless}/metadata.json`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const payload = await response.json();
      const metadata = payload.metadata || payload;
      return {
        found: true,
        source: url,
        contractName: Object.values(metadata.settings?.compilationTarget || {})[0] || metadata.output?.devdoc?.title,
        abi: metadata.output?.abi || [],
      };
    } catch (error) {
      continue;
    }
  }

  return { found: false, source: "Sourcify lookup failed", abi: [] };
}

async function fetchMethodSignatures(selector) {
  if (!selector || selector === "0x") return [];

  try {
    const response = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${selector}`);
    if (response.ok) {
      const data = await response.json();
      const matches = data.result?.function?.[selector] || [];
      if (matches.length) return matches.slice(0, 5).map((item) => item.name);
    }
  } catch (error) {
    // Fall back to 4byte below.
  }

  try {
    const response = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.results || []).slice(0, 5).map((item) => item.text_signature);
  } catch (error) {
    return [];
  }
}

async function fetchRealTransaction(txHash, networkKey) {
  const network = networks[networkKey];
  const [tx, receipt] = await Promise.all([
    rpc(network, "eth_getTransactionByHash", [txHash]),
    rpc(network, "eth_getTransactionReceipt", [txHash]),
  ]);

  if (!tx) throw new Error("RPC 没有找到这笔交易，可能是网络选错或交易哈希不存在。");
  if (!receipt) throw new Error("找到了交易，但 receipt 还不可用，交易可能尚未确认。");

  const transferLogs = receipt.logs.filter(
    (log) => normalizeAddress(log.topics?.[0]) === TRANSFER_TOPIC && log.topics?.length >= 3 && log.data && log.data !== "0x",
  );
  const tokenAddresses = [...new Set(transferLogs.map((log) => normalizeAddress(log.address)))];
  const tokenMetadataEntries = await Promise.all(
    tokenAddresses.map(async (address) => [address, await fetchTokenMetadata(network, address)]),
  );
  const tokenMetadata = Object.fromEntries(tokenMetadataEntries);

  const transfers = transferLogs.map((log) => {
    const token = tokenMetadata[normalizeAddress(log.address)] || { symbol: "UNKNOWN", decimals: 18, label: "Unknown Token" };
    return {
      tokenAddress: log.address,
      tokenLabel: token.label,
      symbol: token.symbol,
      from: topicToAddress(log.topics[1]),
      to: topicToAddress(log.topics[2]),
      rawValue: hexToBigInt(log.data).toString(),
      amount: formatUnits(hexToBigInt(log.data).toString(), token.decimals),
      source: "receipt.logs + ERC-20 Transfer event signature",
    };
  });

  const inputSelector = tx.input && tx.input !== "0x" ? tx.input.slice(0, 10) : null;
  const [routerAbi, methodCandidates] = await Promise.all([
    tx.to ? fetchSourcifyMetadata(network.chainId, tx.to) : Promise.resolve({ found: false, abi: [] }),
    inputSelector ? fetchMethodSignatures(inputSelector) : Promise.resolve([]),
  ]);

  return {
    network: network.name,
    nativeSymbol: network.nativeSymbol,
    transaction: {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      valueEth: formatWei(tx.value),
      status: receipt.status === "0x1" ? "success" : "failed",
      blockNumber: hexToNumber(receipt.blockNumber || tx.blockNumber),
      timestamp: "未查询区块时间，可扩展 eth_getBlockByNumber",
      method: methodCandidates[0] || inputSelector || "unknown",
      input: tx.input,
      gasUsed: receipt.gasUsed ? hexToBigInt(receipt.gasUsed).toString() : null,
    },
    router: {
      label: routerAbi.contractName || "Unknown Contract",
      abiSource: routerAbi.source,
    },
    input: {
      selector: inputSelector,
      methodCandidates,
      source: methodCandidates.length ? "OpenChain Signature Database / 4byte fallback" : "raw transaction.input",
    },
    abi: {
      routerAbiFound: routerAbi.found,
      routerAbiSource: routerAbi.source,
      routerAbiPreview: routerAbi.abi.slice(0, 8),
    },
    transfers,
    decodedBy: {
      transaction: "eth_getTransactionByHash",
      receipt: "eth_getTransactionReceipt",
      logs: "ERC-20 Transfer topic",
      tokenAmounts: "eth_call symbol/decimals/name",
      abi: "Sourcify metadata when available",
      method: "function selector lookup when available",
    },
  };
}

function renderExplanation(explanation) {
  const summary = document.querySelector("#summary");
  summary.innerHTML = `
    <article class="insight wide">
      <h2>用户发起了什么动作 <span class="badge model">模型推断</span></h2>
      <p>${explanation.action.text}</p>
      <p><strong>来源边界：</strong>${explanation.action.source}</p>
    </article>

    <article class="insight wide">
      <h2>涉及哪些资产和地址 <span class="badge chain">链上事实</span></h2>
      <table class="asset-table">
        <thead>
          <tr><th>角色</th><th>地址或资产</th><th>来源</th></tr>
        </thead>
        <tbody>
          ${explanation.assetsAndAddresses
            .map(
              (item) => `
                <tr>
                  <td>${item.role}</td>
                  <td class="mono">${item.value}</td>
                  <td>${item.source}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </article>

    <article class="insight">
      <h2>事实 / 推断边界 <span class="badge abi">边界</span></h2>
      <ul>${explanation.boundaries.map((item) => `<li>${item}</li>`).join("")}</ul>
    </article>

    <article class="insight">
      <h2>不确定的地方 <span class="badge warn">不确定</span></h2>
      <ul>${explanation.uncertainty.map((item) => `<li>${item}</li>`).join("")}</ul>
    </article>

    <article class="insight wide">
      <h2>签类似交易前应检查什么 <span class="badge model">模型建议</span></h2>
      <ul>${explanation.signingChecklist.map((item) => `<li>${item}</li>`).join("")}</ul>
    </article>
  `;
}

async function renderHash(hash, options = {}) {
  const fixture = fixtures[hash];
  const summary = document.querySelector("#summary");

  if (fixture && options.mode !== "real") {
    const facts = deriveChainFacts(fixture);
    const context = buildLlmContext(facts);
    const explanation = simulateLlmExplanation(facts);
    renderExplanation(explanation);
    document.querySelector("#facts-json").textContent = JSON.stringify(facts, null, 2);
    document.querySelector("#prompt-json").textContent = JSON.stringify(context, null, 2);
    setStatus("当前显示内置样例。输入真实交易哈希会尝试在线查询。");
    return;
  }

  if (!/^0x([A-Fa-f0-9]{64})$/.test(hash)) {
    summary.innerHTML = `
      <article class="insight wide error">
        <h2>交易哈希格式不正确</h2>
        <p>请输入 0x 开头、64 个十六进制字符的交易哈希。</p>
        <p class="mono">${hash}</p>
      </article>
    `;
    document.querySelector("#facts-json").textContent = "";
    document.querySelector("#prompt-json").textContent = "";
    return;
  }

  try {
    setStatus("正在查询 RPC、receipt、Transfer 事件、token metadata、ABI 和函数签名...");
    summary.innerHTML = `
      <article class="insight wide">
        <h2>正在查询真实链上数据</h2>
        <p>如果公共 RPC 或 ABI 服务暂时不可用，结果会显示失败原因；样例数据仍可离线使用。</p>
      </article>
    `;

    const facts = await fetchRealTransaction(hash, options.networkKey || "ethereum");
    const context = buildLlmContext(facts);
    const explanation = simulateLlmExplanation(facts);
    renderExplanation(explanation);
    document.querySelector("#facts-json").textContent = JSON.stringify(facts, null, 2);
    document.querySelector("#prompt-json").textContent = JSON.stringify(context, null, 2);
    setStatus("真实查询完成。请切到“链上事实”和“LLM 上下文”检查来源边界。");
  } catch (error) {
    summary.innerHTML = `
      <article class="insight wide error">
        <h2>真实查询失败</h2>
        <p>${error.message}</p>
        <p>你仍然可以点击“载入样例”查看完整解释流程。真实项目建议使用自己的 RPC / 索引器 / ABI 服务来提高稳定性。</p>
      </article>
    `;
    document.querySelector("#facts-json").textContent = "";
    document.querySelector("#prompt-json").textContent = "";
    setStatus("查询失败。公共 RPC 或第三方 ABI 服务可能不可用，也可能是 CORS 限制。");
  }
}

document.querySelector("#tx-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const hash = new FormData(event.currentTarget).get("txHash").trim();
  const networkKey = new FormData(event.currentTarget).get("network");
  await renderHash(hash, { mode: hash === SAMPLE_HASH ? "sample" : "real", networkKey });
});

document.querySelector("#sample-button").addEventListener("click", async () => {
  document.querySelector("#tx-hash").value = SAMPLE_HASH;
  await renderHash(SAMPLE_HASH, { mode: "sample" });
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.tab}`).classList.add("active");
  });
});

renderHash(SAMPLE_HASH, { mode: "sample" });
