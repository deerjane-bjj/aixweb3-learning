const defaultTemplate = `用户意图：我想给 Alice 转 100 USDC
交易目标地址：0xUSDC_TOKEN
函数名：transfer
参数：to=0xAlice, amount=100 USDC
资产变化：用户减少 100 USDC
Simulation：成功，没有警告`;

const requiredFields = [
  "summary",
  "asset_changes",
  "permissions_changed",
  "risk_level",
  "requires_human_approval",
  "uncertainties",
  "recommended_user_checks"
];

let inputState = {
  hasTemplate: true,
  hasCoreFields: true,
  hasSimulation: true
};

const transactionTemplate = document.querySelector("#transactionTemplate");
const jsonOutput = document.querySelector("#jsonOutput");
const caseResult = document.querySelector("#caseResult");
const riskBadge = document.querySelector("#riskBadge");
const checks = document.querySelector("#checks");

function extractField(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}[：:]\\s*([^\\n]+)`, "i");
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return "";
}

function parseKeyValueParams(text) {
  const params = {};
  text.split(",").forEach((pair) => {
    const [rawKey, ...rawValue] = pair.split("=");
    if (!rawKey || !rawValue.length) return;
    const key = rawKey.trim();
    const value = rawValue.join("=").trim();
    if (key) params[key] = value;
  });
  return params;
}

function parseTemplateInput() {
  const raw = transactionTemplate.value.trim();
  const intent = extractField(raw, ["用户意图", "用户原始意图", "原始意图"]);
  const target = extractField(raw, ["交易目标地址", "目标地址"]);
  const functionName = extractField(raw, ["函数名", "function"]) || (/授权|approve/i.test(raw) ? "approve" : "transfer");
  const paramsText = extractField(raw, ["参数", "params"]);
  const assetChangesText = extractField(raw, ["资产变化", "asset changes"]);
  const simulation = extractField(raw, ["Simulation", "simulation", "模拟结果"]);
  const params = parseKeyValueParams(paramsText);
  const amountMatch = (params.amount || assetChangesText || raw).match(/(\d+(?:\.\d+)?)\s*(ETH|USDC|USDT|DAI|WBTC)?/i);
  const tokenMatch = (params.amount || assetChangesText || raw).match(/\b(ETH|USDC|USDT|DAI|WBTC)\b/i);

  if (amountMatch) params.amount = amountMatch[1];
  if (tokenMatch) params.token = tokenMatch[1].toUpperCase();

  const assetChanges = [];
  if (/减少|-/.test(assetChangesText) && amountMatch) {
    assetChanges.push({
      asset: params.token || (amountMatch[2] || "unknown").toUpperCase(),
      direction: "out",
      amount: amountMatch[1],
      to: params.to || params.spender || target
    });
  }

  inputState = {
    hasTemplate: Boolean(raw),
    hasCoreFields: Boolean(intent && target && functionName && paramsText),
    hasSimulation: Boolean(simulation)
  };

  return {
    raw_template: raw,
    transaction: {
      target_address: target,
      function_name: functionName,
      params,
      asset_changes: assetChanges
    },
    simulation_result: simulation,
    user_intent: intent
  };
}

function simulateModel(data) {
  const tx = data.transaction;
  const sim = data.simulation_result.toLowerCase();
  const intent = data.user_intent.toLowerCase();
  const hasInputProblem = !tx.target_address || !tx.function_name || !data.user_intent || !inputState.hasTemplate;

  if (hasInputProblem) {
    return {
      summary: "输入缺少关键字段，无法可靠判断交易风险。",
      asset_changes: [],
      permissions_changed: [],
      risk_level: "high",
      requires_human_approval: true,
      uncertainties: ["模板中缺少用户意图、交易目标地址、函数名、参数、资产变化或 Simulation。"],
      recommended_user_checks: ["补全模板后重新生成摘要。", "不要在信息不完整时签名交易。"]
    };
  }

  const priorityRisk = evaluatePriorityRisk(tx, intent);
  const isUnlimitedApproval = priorityRisk.isUnlimitedApproval;
  const hasSpenderMismatch = priorityRisk.hasSpenderMismatch;
  const recipient = tx.params.to || tx.params.spender || tx.target_address;
  const targetMismatch = tx.function_name === "transfer" && !intentMatchesRecipient(intent, recipient);
  const hasPermissionChange = tx.function_name === "approve" || /获得|开放|新增|授权/.test(sim) && !sim.includes("没有新增授权");

  let risk = "low";
  if (priorityRisk.high || targetMismatch) risk = "high";
  else if (hasPermissionChange) risk = "medium";

  return {
    summary: summarize(tx, isUnlimitedApproval, targetMismatch, hasSpenderMismatch),
    asset_changes: tx.asset_changes.length
      ? tx.asset_changes.map((change) => `${change.asset} ${change.direction === "out" ? "-" : "+"}${change.amount} -> ${change.to}`)
      : ["没有立即资产转移"],
    permissions_changed: buildPermissionChanges(tx, hasPermissionChange, isUnlimitedApproval),
    risk_level: risk,
    requires_human_approval: risk !== "low",
    uncertainties: buildUncertainties(isUnlimitedApproval, targetMismatch, sim, hasSpenderMismatch),
    recommended_user_checks: buildRecommendedChecks(risk, recipient)
  };
}

function evaluatePriorityRisk(tx, intent) {
  const isApproval = tx.function_name === "approve";
  const spender = String(tx.params.spender || "").toLowerCase();
  const isUnlimitedApproval = isApproval && isUnlimitedApprovalAmount(tx.params.amount);
  const intendedSpender = extractIntendedSpender(intent);
  const spenderIsUnknown = !spender || spender.includes("unknown spender") || spender === "unknown";
  const hasSpenderMismatch = isApproval && intendedSpender &&
    (spenderIsUnknown || !spenderMatchesIntent(spender, intendedSpender));

  return {
    high: isUnlimitedApproval || hasSpenderMismatch,
    isUnlimitedApproval,
    hasSpenderMismatch
  };
}

function extractIntendedSpender(intent) {
  const patterns = [
    /授权\s+([a-z0-9_\-\u4e00-\u9fa5]+)/i,
    /给\s+([a-z0-9_\-\u4e00-\u9fa5]+)\s*授权/i,
    /approve\s+([a-z0-9_\-\u4e00-\u9fa5]+)/i
  ];

  for (const pattern of patterns) {
    const match = intent.match(pattern);
    if (match) return normalizeSpenderName(match[1]);
  }
  return "";
}

function spenderMatchesIntent(spender, intendedSpender) {
  const normalizedSpender = normalizeSpenderName(spender);
  return normalizedSpender.includes(intendedSpender) || intendedSpender.includes(normalizedSpender);
}

function normalizeSpenderName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^0x/, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

function isUnlimitedApprovalAmount(amount) {
  const value = String(amount || "").toLowerCase().replace(/\s+/g, " ").trim();
  return /^(unlimited|infinite|max|max uint|max uint256|2\^256-1|最大值|无限授权)$/.test(value) ||
    value.includes("115792089237316195423570985008687907853269984665640564039457584007913129639935");
}

function intentMatchesRecipient(intent, recipient) {
  if (!recipient) return false;
  const normalizedRecipient = recipient.toLowerCase();
  const recipientAlias = normalizedRecipient.replace(/^0x/, "");
  return intent.includes(normalizedRecipient) || intent.includes(recipientAlias);
}

function buildPermissionChanges(tx, hasPermissionChange, isUnlimitedApproval) {
  if (!hasPermissionChange) return ["没有新增授权"];
  if (isUnlimitedApproval) {
    return [
      {
        asset: tx.params.token || "unknown",
        spender: tx.params.spender || "unknown spender",
        permission: "unlimited approval",
        risk: "spender may transfer the user's tokens in the future"
      }
    ];
  }
  return ["存在授权变化，需要核对额度与 spender"];
}

function summarize(tx, isUnlimitedApproval, targetMismatch, hasSpenderMismatch) {
  const amount = tx.params.amount || "未知数量";
  const token = tx.params.token || "";
  if (isUnlimitedApproval) {
    return `这笔交易不会立即转出资产，但会给 ${tx.params.spender || "unknown spender"} 无限 ${token || "unknown"} 授权。`;
  }
  if (hasSpenderMismatch) {
    return `这笔 approve 的 spender 是 ${tx.params.spender || "unknown spender"}，与用户意图中的授权对象不匹配。`;
  }
  if (targetMismatch) {
    return `这笔交易会向 ${tx.params.to} 转出 ${amount} ${token}，但目标地址与用户意图不一致。`;
  }
  if (tx.function_name === "transfer") {
    return `这笔交易会向 ${tx.params.to} 转出 ${amount} ${token}。`;
  }
  return `这笔交易调用 ${tx.function_name}，需要继续核对参数和 simulation。`;
}

function buildUncertainties(isUnlimitedApproval, targetMismatch, sim, hasSpenderMismatch) {
  const items = [];
  if (isUnlimitedApproval) items.push("无法仅凭 prompt 判断 spender 是否可信。");
  if (hasSpenderMismatch) items.push("用户意图提到授权对象，但 spender 不是同一个对象或无法识别。");
  if (targetMismatch) items.push("目标地址与用户原始意图冲突，需要用户重新确认。");
  if (!sim.includes("成功")) items.push("simulation 没有明确成功结果。");
  return items.length ? items : ["未发现明显不确定点，但仍应核对钱包弹窗字段。"];
}

function buildRecommendedChecks(risk, recipient) {
  const checks = [`核对钱包弹窗里的目标地址：${recipient}`];
  checks.push("核对资产、数量、网络和 gas。");
  if (risk === "high") checks.push("暂停签名，先用区块浏览器或可信来源验证目标地址。");
  return checks;
}

function classifyCase(source) {
  const tx = source.transaction;
  const intent = source.user_intent.toLowerCase();
  const recipient = tx.params.to || tx.params.spender || tx.target_address;
  const priorityRisk = evaluatePriorityRisk(tx, intent);
  const targetMismatch = tx.function_name === "transfer" && recipient && !intentMatchesRecipient(intent, recipient);

  if (!tx.target_address || !tx.function_name || !source.user_intent || !inputState.hasTemplate) {
    return "输入不完整，暂不能匹配三组案例";
  }
  if (priorityRisk.isUnlimitedApproval) return "无限授权";
  if (priorityRisk.hasSpenderMismatch || targetMismatch) return "目标地址与用户意图不匹配";
  return "普通转账";
}

function validateResult(result, source) {
  const missing = requiredFields.filter((field) => !(field in result));
  const schemaOk = missing.length === 0 && ["low", "medium", "high"].includes(result.risk_level);
  const approvalOk = result.risk_level === "low" || result.requires_human_approval === true;
  const mismatchDetected = source.transaction.function_name !== "transfer" ||
    intentMatchesRecipient(source.user_intent.toLowerCase(), source.transaction.params.to || "") ||
    result.risk_level === "high";
  const approvalDetected = source.transaction.function_name !== "approve" ||
    result.permissions_changed.some((item) => typeof item === "string" ? item.includes("授权") : item.permission);
  const priorityRiskOk = validatePriorityRules(result, source);

  return [
    {
      title: "JSON schema",
      state: schemaOk ? "pass" : "fail",
      body: schemaOk ? "所有必需字段存在，risk_level 枚举合法。" : `缺少字段：${missing.join(", ")}`
    },
    {
      title: "高风险人工确认",
      state: approvalOk ? "pass" : "fail",
      body: approvalOk ? "medium/high 风险会强制 requires_human_approval。" : "高风险输出没有要求人工确认。"
    },
    {
      title: "Web3 风险规则",
      state: mismatchDetected && approvalDetected ? "pass" : "warn",
      body: mismatchDetected && approvalDetected
        ? "地址不匹配和授权变化能被代码层规则复核。"
        : "存在 prompt 可能漏判的风险，需要 Guard 拦截。"
    },
    {
      title: "高优先级规则",
      state: priorityRiskOk ? "pass" : "fail",
      body: priorityRiskOk
        ? "无限授权和授权对象不匹配会先于普通规则执行。"
        : "高优先级风险规则没有被正确强制执行。"
    }
  ];
}

function validatePriorityRules(result, source) {
  const priorityRisk = evaluatePriorityRisk(source.transaction, source.user_intent.toLowerCase());
  if (!priorityRisk.high) return true;

  const highRiskEnforced = result.risk_level === "high" && result.requires_human_approval === true;
  if (!priorityRisk.isUnlimitedApproval) return highRiskEnforced;

  return highRiskEnforced && result.permissions_changed.some((item) =>
    typeof item === "object" &&
    item.asset &&
    item.spender &&
    item.permission === "unlimited approval" &&
    item.risk === "spender may transfer the user's tokens in the future"
  );
}

function runDemo() {
  const source = parseTemplateInput();
  const result = simulateModel(source);
  const validation = validateResult(result, source);
  const inputValidation = validateInputs();
  const caseName = classifyCase(source);

  caseResult.innerHTML = `案例：<span>${caseName}</span>`;
  jsonOutput.textContent = JSON.stringify(result, null, 2);
  riskBadge.textContent = result.risk_level.toUpperCase();
  riskBadge.className = `badge ${result.risk_level}`;

  checks.innerHTML = [...inputValidation, ...validation].map((item) => `
    <article class="check ${item.state}">
      <strong>${item.title}</strong>
      <p>${item.body}</p>
    </article>
  `).join("");
}

function validateInputs() {
  return [
    {
      title: "输入模板",
      state: inputState.hasTemplate ? "pass" : "fail",
      body: inputState.hasTemplate ? "已收到交易描述模板。" : "请输入交易描述模板。"
    },
    {
      title: "关键字段抽取",
      state: inputState.hasCoreFields ? "pass" : "fail",
      body: inputState.hasCoreFields ? "已抽取用户意图、目标地址、函数名和参数。" : "模板里需要包含用户意图、目标地址、函数名和参数。"
    },
    {
      title: "Simulation 线索",
      state: inputState.hasSimulation ? "pass" : "warn",
      body: inputState.hasSimulation ? "模板中包含 Simulation 结果。" : "没有找到 Simulation，输出会保留更多不确定性。"
    }
  ];
}

document.querySelector("#runButton").addEventListener("click", runDemo);
transactionTemplate.value = defaultTemplate;
runDemo();
