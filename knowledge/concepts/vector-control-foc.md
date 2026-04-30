---
id: KB-concept-vector-control-foc
type: concept
tags: [FOC, 矢量控制, id=0, 电流环, 速度环]
source: 案例提取 - 永磁同步电机simulink伺服控制
created: 2026-04-30
---

# 矢量控制(FOC) — id=0策略

## 控制架构

```
速度参考 → [PI速度环] → iq参考 → [PI电流环q] → vq → [Park逆变换] → vα,vβ → [SVPWM] → 逆变器
                ↓                              ↓
            ω_m反馈                        id参考=0 → [PI电流环d] → vd ↗
```

## 坐标变换

### Clarke变换 (abc → αβ)
$$
i_\alpha = i_a
$$
$$
i_\beta = \frac{1}{\sqrt{3}}(i_a + 2i_b)
$$

### Park变换 (αβ → dq)
$$
i_d = i_\alpha \cos\theta_e + i_\beta \sin\theta_e
$$
$$
i_q = -i_\alpha \sin\theta_e + i_\beta \cos\theta_e
$$

## PI控制器参数设计

### 电流环(内环)
- 带宽: 通常1-5kHz
- Kp_i = ωc * L (ωc为电流环带宽)
- Ki_i = ωc * Rs

### 速度环(外环)
- 带宽: 通常为电流环带宽的1/10
- Kp_ω = J * ωs / ψ_f (ωs为速度环带宽)
- Ki_ω = 根据阻尼比设计

## id=0策略特点

- **优点**: 转矩与iq成正比，控制简单
- **适用**: 表贴式PMSM (Ld ≈ Lq)
- **注意**: 弱磁区需id<0

## 关联知识
- KB-concept-pmsm-math-model — PMSM数学模型
- KB-concept-svpwm — SVPWM调制
- KB-concept-fuzzy-pid — 模糊PID速度环
