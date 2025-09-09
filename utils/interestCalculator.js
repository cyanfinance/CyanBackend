function calculateMuthootGoldLoanInterest({
  principal,
  annualRate,
  disbursementDate,
  closureDate,
  minRateThreshold = 14,
  minInterestAmount = 50
}) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysOutstanding = Math.ceil((closureDate - disbursementDate) / msPerDay);
  const dailyRate = annualRate / 100 / 365;

  // Determine minimum days
  let minDays = 0;
  if (annualRate > minRateThreshold) minDays = 7;
  else minDays = 15;

  const effectiveDays = daysOutstanding < minDays ? minDays : daysOutstanding;

  // Monthly compounding
  const months = Math.ceil(effectiveDays / 30);
  let amount = principal;
  for (let i = 0; i < months; i++) {
    // For each month, calculate interest for up to 30 days
    const daysThisMonth = Math.min(30, effectiveDays - i * 30);
    const interest = amount * dailyRate * daysThisMonth;
    amount += interest; // Compound
  }

  let totalInterest = amount - principal;
  if (totalInterest < minInterestAmount) totalInterest = minInterestAmount;

  return {
    totalInterest: Math.round(totalInterest),
    totalAmount: Math.round(principal + totalInterest),
    effectiveDays,
    months
  };
}

module.exports = { calculateMuthootGoldLoanInterest }; 