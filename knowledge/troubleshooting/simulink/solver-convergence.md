---
id: KB-troubleshooting-solver-convergence
type: troubleshooting
tags: [Solver, 收敛, ode15s, 步长, 刚性系统]
source: 仿真调试经验
created: 2026-04-30
---

# Simulink Solver收敛问题

## 症状

- 错误信息: "Step size too small" 或 "Convergence failed"
- 仿真运行极慢
- 结果出现不连续跳变

## 常见原因

### 1. 刚性系统使用了非刚性Solver

- **原因**: 电力电子开关动作导致系统刚性强
- **修复**: 使用 ode15s / ode23tb 替代 ode45

### 2. 最大步长设置过大

- **原因**: PWM开关频率10kHz对应周期100μs，步长必须远小于此
- **修复**: 设置 maxStep = 1e-5 或更小

### 3. 代数环

- **原因**: 模块间存在瞬时反馈回路
- **修复**: 
  - 添加 Delay 模块打破环
  - 使用 Algebraic Constraint 模块
  - 启用 Simulink 的代数环求解器

### 4. 初始条件不当

- **原因**: 电机初始状态未设置或设置不合理
- **修复**: 在 params.m 中设置合理的初始条件

## 诊断流程

```
仿真失败 → 查看错误类型
  ├─ "Step size too small" → 检查Solver类型 → 切换ode15s
  ├─ "Algebraic loop" → 定位环路 → 添加Delay
  ├─ NaN/Inf → 检查初始条件 → 检查除零
  └─ 未知错误 → 降低步长 → 检查模型连接
```

## 关联知识
- KB-procedure-simulink-model-building
