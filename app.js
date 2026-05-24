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
  hasSimulation: true,
  missingFields: []
};

const transactionTemplate = document.querySelector("#transactionTemplate");
const jsonOutput = document.querySelector("#jsonOutput");
const caseResult = document.querySelector("#caseResult");
const riskBadge = document.querySelector("#riskBadge");
const checks = document.querySelector("#checks");

function extractField(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}[：:][ \\t]*([^\\n]*)`, "i");
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
  const explicitFunctionName = extractField(raw, ["函数名", "function"]);
  const functionName = explicitFunctionName;
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
    hasCoreFields: Boolean(intent && target && explicitFunctionName && paramsText && assetChangesText && simulation),
    hasSimulation: Boolean(simulation),
    missingFields: getMissingFields({
      "用户意图": intent,
      "交易目标地址": target,
      "函数名": explicitFunctionName,
      "参数": paramsText,
      "资产变化": assetChangesText,
      "Simulation": simulation
    })
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

function getMissingFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => isMissingValue(value))
    .map(([label]) => label);
}

function isMissingValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized ||
    ["unknown", "null", "undefined", "n/a", "na", "-"].includes(normalized) ||
    /未知|未提供|无法判断|不确定|空/.test(normalized);
}

function simulateModel(data) {
  const tx = data.transaction;
  const sim = data.simulation_result.toLowerCase();
  const intent = data.user_intent.toLowerCase();
  const priorityRisk = evaluatePriorityRisk(tx, intent);
  const intentMismatch = evaluateIntentMismatch(data, priorityRisk);
  const isUnlimitedApproval = priorityRisk.isUnlimitedApproval;
  const hasSpenderMismatch = intentMismatch.hasSpenderMismatch;
  const recipient = tx.params.to || tx.params.spender || tx.target_address;
  const targetMismatch = intentMismatch.hasRecipientMismatch;
  const amountMismatch = intentMismatch.hasAmountMismatch;
  const hasPermissionChange = tx.function_name === "approve" || /获得|开放|新增|授权/.test(sim) && !sim.includes("没有新增授权");
  const hasMissingFields = inputState.missingFields.length > 0 || !inputState.hasTemplate;
  const simulationClean = isSimulationClean(sim);

  let risk = "low";
  if (priorityRisk.high || intentMismatch.high) risk = "high";
  else if (hasMissingFields) risk = "medium";
  else if (hasPermissionChange) risk = "medium";
  else if (!simulationClean) risk = "medium";

  return {
    summary: summarize(tx, isUnlimitedApproval, targetMismatch, hasSpenderMismatch, amountMismatch),
    asset_changes: tx.asset_changes.length
      ? tx.asset_changes.map((change) => `${change.asset} ${change.direction === "out" ? "-" : "+"}${change.amount} -> ${change.to}`)
      : ["没有立即资产转移"],
    permissions_changed: buildPermissionChanges(tx, hasPermissionChange, isUnlimitedApproval),
    risk_level: risk,
    requires_human_approval: risk !== "low",
    uncertainties: buildUncertainties(isUnlimitedApproval, targetMismatch, sim, hasSpenderMismatch, inputState.missingFields, amountMismatch),
    recommended_user_checks: buildRecommendedChecks(risk, recipient)
  };
}

function evaluatePriorityRisk(tx, intent) {
  const isApproval = tx.function_name === "approve";
  const isUnlimitedApproval = isApproval && isUnlimitedApprovalAmount(tx.params.amount);

  return {
    high: isUnlimitedApproval,
    isUnlimitedApproval
  };
}

function evaluateIntentMismatch(data, priorityRisk) {
  const tx = data.transaction;
  const intent = data.user_intent.toLowerCase();
  const recipient = tx.params.to || tx.params.spender || tx.target_address;
  const intendedRecipient = extractIntendedRecipient(intent);
  const intendedSpender = extractIntendedSpender(intent);
  const spender = String(tx.params.spender || "").toLowerCase();
  const spenderIsUnknown = isMissingValue(spender) || spender.includes("unknown spender");
  const hasSpenderMismatch = tx.function_name === "approve" && intendedSpender &&
    (spenderIsUnknown || !spenderMatchesIntent(spender, intendedSpender));
  const hasRecipientMismatch = tx.function_name === "transfer" && intendedRecipient && recipient &&
    !recipientMatchesIntent(recipient, intendedRecipient);
  const hasAmountMismatch = evaluateAmountMismatch(data, priorityRisk);

  return {
    high: hasSpenderMismatch || hasRecipientMismatch || hasAmountMismatch,
    hasSpenderMismatch,
    hasRecipientMismatch,
    hasAmountMismatch
  };
}

function extractIntendedRecipient(intent) {
  const patterns = [
    /给\s+([a-z0-9_\-\u4e00-\u9fa5]+)/i,
    /转给\s+([a-z0-9_\-\u4e00-\u9fa5]+)/i,
    /send\s+(?:to\s+)?([a-z0-9_\-\u4e00-\u9fa5]+)/i
  ];

  for (const pattern of patterns) {
    const match = intent.match(pattern);
    if (match) return normalizeRecipientName(match[1]);
  }
  return "";
}

function evaluateAmountMismatch(data, priorityRisk) {
  const actualAmount = String(data.transaction.params.amount || "").toLowerCase();
  if (!actualAmount) return false;
  if (isUnlimitedApprovalAmount(actualAmount)) return true;

  const intendedAmount = extractIntentAmount(data.user_intent);
  const actualNumber = parseNumber(actualAmount);
  if (intendedAmount === null || actualNumber === null) return false;

  return actualNumber > intendedAmount * 1.25;
}

function extractIntentAmount(intent) {
  const match = String(intent || "").match(/(\d+(?:\.\d+)?)\s*(ETH|USDC|USDT|DAI|WBTC)?/i);
  return match ? Number(match[1]) : null;
}

function parseNumber(value) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function isSimulationClean(sim) {
  const hasSuccess = sim.includes("成功") || sim.includes("success");
  const explicitlyNoWarning = /没有警告|无警告|no warning|no warnings/.test(sim);
  const hasProblemSignal = /警告|warning|warn|失败|异常|error|revert|风险/.test(sim);
  return hasSuccess && (explicitlyNoWarning || !hasProblemSignal);
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

function recipientMatchesIntent(recipient, intendedRecipient) {
  const normalizedRecipient = normalizeRecipientName(recipient);
  return normalizedRecipient.includes(intendedRecipient) || intendedRecipient.includes(normalizedRecipient);
}

function normalizeRecipientName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^0x/, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
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

function summarize(tx, isUnlimitedApproval, targetMismatch, hasSpenderMismatch, amountMismatch) {
  const amount = tx.params.amount || "未知数量";
  const token = tx.params.token || "";
  if (!inputState.hasTemplate) {
    return "输入模板为空，无法可靠判断交易风险。";
  }
  if (inputState.missingFields.length > 0 && !isUnlimitedApproval && !targetMismatch && !hasSpenderMismatch) {
    return `模板缺少 ${inputState.missingFields.join("、")}，需要补充后再判断交易。`;
  }
  if (isUnlimitedApproval) {
    return `这笔交易不会立即转出资产，但会给 ${tx.params.spender || "unknown spender"} 无限 ${token || "unknown"} 授权。`;
  }
  if (hasSpenderMismatch) {
    return `这笔 approve 的 spender 是 ${tx.params.spender || "unknown spender"}，与用户意图中的授权对象不匹配。`;
  }
  if (amountMismatch) {
    return `交易实际 amount 是 ${tx.params.amount || "unknown"}，与用户意图中的金额明显不一致。`;
  }
  if (targetMismatch) {
    return `这笔交易会向 ${tx.params.to} 转出 ${amount} ${token}，但收款人与用户意图不一致。`;
  }
  if (tx.function_name === "transfer") {
    return `这笔交易会向 ${tx.params.to} 转出 ${amount} ${token}。`;
  }
  return `这笔交易调用 ${tx.function_name}，需要继续核对参数和 simulation。`;
}

function buildUncertainties(isUnlimitedApproval, targetMismatch, sim, hasSpenderMismatch, missingFields = [], amountMismatch = false) {
  const items = [];
  if (missingFields.length > 0) items.push(`模板缺少字段：${missingFields.join("、")}。`);
  if (isUnlimitedApproval) items.push("无法仅凭 prompt 判断 spender 是否可信。");
  if (hasSpenderMismatch) items.push("用户意图提到授权对象，但 spender 不是同一个对象或无法识别。");
  if (amountMismatch) items.push("交易实际 amount 与用户意图中的金额明显不一致。");
  if (targetMismatch) items.push("transfer 参数里的 to 与用户意图中的收款人不一致。");
  if (!sim.includes("成功")) items.push("simulation 没有明确成功结果。");
  else if (!isSimulationClean(sim)) items.push("simulation 成功但包含警告或异常信号。");
  return items.length ? items : ["未发现明显不确定点，但仍应核对钱包弹窗字段。"];
}

function buildRecommendedChecks(risk, recipient) {
  const checks = [`核对钱包弹窗里的收款人或授权对象：${recipient || "unknown"}`];
  checks.push("核对资产、数量、网络和 gas。");
  if (risk === "medium" && inputState.missingFields.length > 0) checks.push("补全模板缺失字段后重新生成摘要。");
  if (risk === "high") checks.push("暂停签名，先用区块浏览器或可信来源验证目标地址。");
  return checks;
}

function classifyCase(source) {
  const tx = source.transaction;
  const priorityRisk = evaluatePriorityRisk(tx, source.user_intent.toLowerCase());
  const intentMismatch = evaluateIntentMismatch(source, priorityRisk);

  if (!tx.target_address || !tx.function_name || !source.user_intent || !inputState.hasTemplate) {
    return "输入不完整，暂不能匹配三组案例";
  }
  if (priorityRisk.isUnlimitedApproval) return "无限授权";
  if (intentMismatch.high) return "目标地址与用户意图不匹配";
  return "普通转账";
}

function validateResult(result, source) {
  const missing = requiredFields.filter((field) => !(field in result));
  const schemaOk = missing.length === 0 && ["low", "medium", "high"].includes(result.risk_level);
  const approvalOk = result.risk_level === "low" || result.requires_human_approval === true;
  const priorityRisk = evaluatePriorityRisk(source.transaction, source.user_intent.toLowerCase());
  const intentMismatch = evaluateIntentMismatch(source, priorityRisk);
  const mismatchDetected = !intentMismatch.high || result.risk_level === "high";
  const approvalDetected = source.transaction.function_name !== "approve" ||
    result.permissions_changed.some((item) => typeof item === "string" ? item.includes("授权") : item.permission);
  const priorityRiskOk = validatePriorityRules(result, source);
  const missingFieldsRuleOk = validateMissingFieldsRule(result, source);
  const lowRiskRuleOk = validateLowRiskRule(result, source);

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
        ? "收款人不匹配、授权对象不匹配和授权变化能被代码层规则复核。"
        : "存在 prompt 可能漏判的风险，需要 Guard 拦截。"
    },
    {
      title: "高优先级规则",
      state: priorityRiskOk ? "pass" : "fail",
      body: priorityRiskOk
        ? "无限授权和授权对象不匹配会先于普通规则执行。"
        : "高优先级风险规则没有被正确强制执行。"
    },
    {
      title: "字段缺失规则",
      state: missingFieldsRuleOk ? "pass" : "fail",
      body: missingFieldsRuleOk
        ? "任一模板字段缺失时至少标记 medium，且不会覆盖 approve + unlimited 的 high。"
        : "字段缺失时的风险等级没有按规则处理。"
    },
    {
      title: "低风险规则",
      state: lowRiskRuleOk ? "pass" : "fail",
      body: lowRiskRuleOk
        ? "只有字段完整、Simulation 成功且无警告、用户意图和实际参数一致、无异常授权时才允许 low。"
        : "当前输出不满足 low 的全部前置条件。"
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

function validateMissingFieldsRule(result, source) {
  const hasMissingFields = inputState.missingFields.length > 0 || !inputState.hasTemplate;
  if (!hasMissingFields) return true;

  const priorityRisk = evaluatePriorityRisk(source.transaction, source.user_intent.toLowerCase());
  if (priorityRisk.high) return result.risk_level === "high" && result.requires_human_approval === true;

  const intentMismatch = evaluateIntentMismatch(source, priorityRisk);
  if (intentMismatch.high) return result.risk_level === "high" && result.requires_human_approval === true;

  return result.risk_level === "medium" && result.requires_human_approval === true;
}

function validateLowRiskRule(result, source) {
  if (result.risk_level !== "low") return true;

  const priorityRisk = evaluatePriorityRisk(source.transaction, source.user_intent.toLowerCase());
  const intentMismatch = evaluateIntentMismatch(source, priorityRisk);
  const hasPermissionChange = source.transaction.function_name === "approve";

  return inputState.missingFields.length === 0 &&
    inputState.hasTemplate &&
    isSimulationClean(source.simulation_result.toLowerCase()) &&
    !priorityRisk.high &&
    !intentMismatch.high &&
    !hasPermissionChange;
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
      body: inputState.hasCoreFields
        ? "已抽取用户意图、目标地址、函数名、参数、资产变化和 Simulation。"
        : `缺少字段：${inputState.missingFields.join("、") || "全部模板内容"}。`
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
