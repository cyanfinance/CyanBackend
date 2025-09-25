/**
 * Clean Simple Interest Calculator
 * Formula: SI = P × R × T
 * Where:
 * - P = Principal amount
 * - R = Annual interest rate (as decimal)
 * - T = Time in years
 */

/**
 * Calculate simple interest for a loan using exact days
 * @param {number} principal - Principal amount (P)
 * @param {number} annualRate - Annual interest rate as percentage (e.g., 18 for 18%)
 * @param {Date} startDate - Loan start date
 * @param {Date} endDate - Loan end date or repayment date
 * @returns {Object} Calculation results
 */
function calculateSimpleInterest(principal, annualRate, startDate, endDate) {
    // Convert percentage to decimal (18% = 0.18)
    const rateDecimal = annualRate / 100;
    
    // Calculate exact time in days and years
    const timeInMilliseconds = endDate - startDate;
    const timeInDays = timeInMilliseconds / (1000 * 60 * 60 * 24);
    const timeInYears = timeInDays / 365;
    
    // Simple Interest Formula: SI = P × R × T
    const interest = principal * rateDecimal * timeInYears;
    
    // Total amount = Principal + Interest
    const totalAmount = principal + interest;
    
    // Round off using standard rounding rule (>= 0.50 rounds up)
    const roundedInterest = Math.round(interest);
    const roundedTotalAmount = Math.round(totalAmount);
    
    return {
        principal: principal,
        interest: roundedInterest,
        totalAmount: roundedTotalAmount,
        rate: annualRate,
        timeInDays: timeInDays,
        timeInYears: timeInYears,
        startDate: startDate,
        endDate: endDate
    };
}

/**
 * Calculate loan details for a specific term
 * @param {number} principal - Principal amount
 * @param {number} annualRate - Annual interest rate as percentage
 * @param {number} termMonths - Loan term in months
 * @param {Date} startDate - Loan start date
 * @returns {Object} Loan calculation results
 */
function calculateLoanDetails(principal, annualRate, termMonths, startDate) {
    // Calculate end date
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + termMonths);
    
    // Calculate simple interest
    const result = calculateSimpleInterest(principal, annualRate, startDate, endDate);
    
    // Calculate monthly payment and round it
    const monthlyPayment = Math.round(result.totalAmount / termMonths);
    
    return {
        ...result,
        termMonths: termMonths,
        monthlyPayment: monthlyPayment,
        endDate: endDate
    };
}

/**
 * Calculate repayment amount for a specific date
 * @param {number} principal - Principal amount
 * @param {number} annualRate - Annual interest rate as percentage
 * @param {Date} loanStartDate - Original loan start date
 * @param {Date} repaymentDate - Date when repayment is made
 * @returns {Object} Repayment calculation results
 */
function calculateRepaymentAmount(principal, annualRate, loanStartDate, repaymentDate) {
    // Calculate simple interest from loan start to repayment date
    const result = calculateSimpleInterest(principal, annualRate, loanStartDate, repaymentDate);
    
    return {
        ...result,
        repaymentDate: repaymentDate
    };
}

module.exports = {
    calculateSimpleInterest,
    calculateLoanDetails,
    calculateRepaymentAmount
};
