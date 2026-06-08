const bankProducts = new Map([
  ["shinhan|term-deposit", { bankName: "신한은행", productName: "정기예금", annualRate: 0.036 }],
  ["kb|term-deposit", { bankName: "국민은행", productName: "정기예금", annualRate: 0.034 }],
  ["hana|term-deposit", { bankName: "하나은행", productName: "정기예금", annualRate: 0.035 }],
  ["default|term-deposit", { bankName: "기본은행", productName: "정기예금", annualRate: 0.036 }],
]);

const form = document.querySelector("#calculator-form");
const errorMessage = document.querySelector("#error-message");
const monthlyTable = document.querySelector("#monthly-table");
const interactiveCards = document.querySelectorAll(".interactive-card");
const spotlightPanel = document.querySelector(".spotlight-panel");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  calculateFromForm();
});

interactiveCards.forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const bounds = card.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const normalizedX = x / bounds.width - 0.5;
    const normalizedY = y / bounds.height - 0.5;

    card.style.setProperty("--tilt-x", `${(-normalizedY * 1.4).toFixed(3)}deg`);
    card.style.setProperty("--tilt-y", `${(normalizedX * 1.4).toFixed(3)}deg`);
  });

  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
  });
});

spotlightPanel.addEventListener("pointermove", (event) => {
  const bounds = spotlightPanel.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / bounds.width) * 100;
  const y = ((event.clientY - bounds.top) / bounds.height) * 100;

  spotlightPanel.style.setProperty("--mouse-x", `${x.toFixed(2)}%`);
  spotlightPanel.style.setProperty("--mouse-y", `${y.toFixed(2)}%`);
});

calculateFromForm();

function calculateFromForm() {
  try {
    errorMessage.textContent = "";

    const formData = new FormData(form);
    const principal = readMoney(formData.get("principal"), "현재 원금");
    const monthlyDeposit = readMoney(formData.get("monthlyDeposit"), "월 납입금");
    const startDate = String(formData.get("startDate"));
    const endDate = String(formData.get("endDate"));
    const bankKey = String(formData.get("bankName"));
    const productKey = String(formData.get("productName"));
    const compound = formData.get("rateMode") === "compound";
    const product = getProduct(bankKey, productKey);
    const months = generateMonths(startDate, endDate);
    const monthlyInterestRates = getBankInterestRates(product, months, compound);
    const cpiData = getCpiData(months);
    const monthlyInflationRates = convertCpiToInflationRates(cpiData, months);
    const monthlyDeposits = Array.from({ length: months.length }, () => monthlyDeposit);
    const result = calculateRealPurchasingPower(
      principal,
      monthlyDeposits,
      monthlyInterestRates,
      monthlyInflationRates,
    );

    renderResult({
      result,
      months,
      product,
      monthlyDeposit,
      monthlyInterestRates,
      monthlyInflationRates,
      cpiData,
    });
  } catch (error) {
    errorMessage.textContent = error.message;
  }
}

function readMoney(value, label) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label}은 0 이상의 숫자로 입력해 주세요.`);
  }

  return number;
}

function generateMonths(startDate, endDate) {
  const start = parseMonth(startDate, "시작 시점");
  const end = parseMonth(endDate, "종료 시점");

  if (start.year > end.year || (start.year === end.year && start.month > end.month)) {
    throw new Error("시작 시점은 종료 시점보다 늦을 수 없습니다.");
  }

  const months = [];
  let year = start.year;
  let month = start.month;

  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;

    if (month === 13) {
      year += 1;
      month = 1;
    }
  }

  return months;
}

function parseMonth(value, label) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`${label}은 YYYY-MM 형식이어야 합니다.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    throw new Error(`${label}의 월은 1부터 12 사이여야 합니다.`);
  }

  return { year, month };
}

function getProduct(bankKey, productKey) {
  return bankProducts.get(`${bankKey}|${productKey}`) ?? bankProducts.get("default|term-deposit");
}

function getBankInterestRates(product, months, compound) {
  const monthlyRate = annualRateToMonthlyRate(product.annualRate, compound);

  return months.map(() => monthlyRate);
}

function annualRateToMonthlyRate(annualRate, compound) {
  if (annualRate <= -1) {
    throw new Error("연 이율은 -100%보다 커야 합니다.");
  }

  return compound ? (1 + annualRate) ** (1 / 12) - 1 : annualRate / 12;
}

function getCpiData(months) {
  let cpi = 112.3;
  const monthlyGrowth = 0.002;
  const cpiData = new Map();

  for (const month of months) {
    cpiData.set(month, round(cpi, 3));
    cpi *= 1 + monthlyGrowth;
  }

  return cpiData;
}

function convertCpiToInflationRates(cpiData, months) {
  const rates = [0];

  for (let index = 1; index < months.length; index += 1) {
    const previousCpi = cpiData.get(months[index - 1]);
    const currentCpi = cpiData.get(months[index]);

    if (!previousCpi || !currentCpi) {
      throw new Error("CPI 데이터가 누락되었습니다.");
    }

    rates.push(currentCpi / previousCpi - 1);
  }

  return rates;
}

function calculateRealPurchasingPower(
  principal,
  monthlyDeposits,
  monthlyInterestRates,
  monthlyInflationRates,
) {
  const n = monthlyInterestRates.length;

  if (monthlyDeposits.length !== n || monthlyInflationRates.length !== n) {
    throw new Error("납입금, 이자율, 물가상승률 목록의 길이가 같아야 합니다.");
  }

  let nominalValue = principal;

  for (const rate of monthlyInterestRates) {
    nominalValue *= 1 + rate;
  }

  for (let depositMonth = 0; depositMonth < n; depositMonth += 1) {
    let depositValue = monthlyDeposits[depositMonth];

    for (let growthMonth = depositMonth + 1; growthMonth < n; growthMonth += 1) {
      depositValue *= 1 + monthlyInterestRates[growthMonth];
    }

    nominalValue += depositValue;
  }

  let discountFactor = 1;

  for (const inflationRate of monthlyInflationRates) {
    discountFactor *= 1 + inflationRate;
  }

  if (discountFactor <= 0) {
    throw new Error("누적 할인계수는 0보다 커야 합니다.");
  }

  const realValue = nominalValue / discountFactor;
  const totalDeposit = principal + monthlyDeposits.reduce((sum, value) => sum + value, 0);

  return {
    totalDeposit,
    nominalFutureValue: nominalValue,
    discountFactor,
    realPurchasingPower: realValue,
    nominalProfit: nominalValue - totalDeposit,
    realProfit: realValue - totalDeposit,
  };
}

function renderResult(data) {
  const {
    result,
    months,
    product,
    monthlyDeposit,
    monthlyInterestRates,
    monthlyInflationRates,
    cpiData,
  } = data;

  setText("real-purchasing-power", formatWon(result.realPurchasingPower));
  setText("real-profit", formatWon(result.realProfit));
  setText("total-deposit", formatWon(result.totalDeposit));
  setText("nominal-future-value", formatWon(result.nominalFutureValue));
  setText("nominal-profit", formatWon(result.nominalProfit));
  setText("discount-factor", result.discountFactor.toFixed(6));
  setText("period-detail", `${months[0]} ~ ${months.at(-1)} · ${months.length}개월`);
  setText(
    "rate-detail",
    `${product.bankName} / ${product.productName} · 월 이율 ${formatPercent(monthlyInterestRates[0])}`,
  );
  setText("inflation-detail", `평균 월 물가상승률 ${formatPercent(average(monthlyInflationRates.slice(1)))}`);

  monthlyTable.replaceChildren(
    ...months.map((month, index) => {
      const row = document.createElement("tr");
      const cells = [
        month,
        formatPercent(monthlyInterestRates[index]),
        cpiData.get(month).toFixed(3),
        formatPercent(monthlyInflationRates[index]),
        formatWon(monthlyDeposit),
      ];

      for (const cellText of cells) {
        const cell = document.createElement("td");
        cell.textContent = cellText;
        row.append(cell);
      }

      return row;
    }),
  );
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function formatWon(value) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(4)}%`;
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, places) {
  return Number(value.toFixed(places));
}
