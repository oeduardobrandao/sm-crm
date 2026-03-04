import { getClientes, getMembros, Cliente, Membro } from '../store';
import { showToast } from '../router';

export async function renderCalendario(container: HTMLElement): Promise<void> {
  // Styles
  if (!document.getElementById('calendar-styles')) {
    const style = document.createElement('style');
    style.id = 'calendar-styles';
    style.innerHTML = `
      .calendar-layout { display: grid; grid-template-columns: 1fr 340px; gap: 2rem; align-items: start; height: calc(100vh - 120px); }
      @media (max-width: 1024px) { .calendar-layout { grid-template-columns: 1fr; height: auto; } }
      
      .calendar-main { background: var(--card-bg); border-radius: var(--radius); padding: 2rem; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 1.5rem; }
      .calendar-header { display: flex; justify-content: space-between; align-items: center; }
      .calendar-title-group { display: flex; align-items: baseline; gap: 0.5rem; }
      .calendar-title-group h2 { font-size: 1.4rem; font-weight: 600; color: var(--text-main); }
      .calendar-title-group span { font-size: 1.4rem; color: var(--text-muted); font-weight: 400; }
      
      .calendar-nav { display: flex; gap: 0.5rem; }
      .calendar-nav button { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border-color); background: transparent; color: var(--text-main); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: var(--transition); }
      .calendar-nav button:hover { background: var(--surface-hover); }

      .calendar-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: left; padding: 0 0.5rem; color: var(--text-muted); font-size: 0.85rem; font-weight: 500; margin-bottom: 0.5rem; }
      
      .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.75rem; }
      .calendar-day { background: var(--surface-main); border: 1px solid var(--border-color); border-radius: 16px; min-height: 120px; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; transition: var(--transition); cursor: pointer; position: relative; overflow: hidden; }
      .calendar-day:hover { border-color: var(--primary-color); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
      .calendar-day.empty { background: transparent; border: none; cursor: default; box-shadow: none; pointer-events: none; }
      .calendar-day.today { border: 1px solid var(--primary-color); background: rgba(52, 98, 238, 0.05); }
      .calendar-day.selected { border: 2px dashed var(--primary-color); }
      .calendar-day.has-events::before { content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0; background: radial-gradient(circle at top right, rgba(52,98,238,0.15) 0%, transparent 70%); pointer-events: none; }
      
      .day-number { font-size: 1.2rem; font-weight: 600; color: var(--text-main); }
      
      .day-events { display: flex; flex-direction: column; gap: 0.35rem; margin-top: auto; }
      .event-pill { font-size: 0.75rem; padding: 0.3rem 0.5rem; border-radius: 6px; display: flex; align-items: center; gap: 0.3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
      .event-pill.income { background: rgba(62, 207, 142, 0.1); color: var(--success); border-left: 2px solid var(--success); }
      .event-pill.expense { background: rgba(239, 227, 71, 0.1); color: #d4c833; border-left: 2px solid var(--warning); }
      
      .scheduled-panel { background: var(--card-bg); border-radius: var(--radius); padding: 2rem; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 1.5rem; }
      .scheduled-header h3 { font-size: 1.2rem; color: var(--text-main); margin-bottom: 0.2rem; }
      .scheduled-header p { font-size: 0.85rem; color: var(--text-muted); }
      
      .scheduled-list { display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; padding-right: 0.5rem;}
      .scheduled-item { background: var(--surface-main); border: 1px solid var(--border-color); border-radius: 16px; padding: 1.2rem; display: flex; flex-direction: column; gap: 0.8rem; }
      .item-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
      .item-title { font-weight: 600; color: var(--text-main); font-size: 0.95rem; line-height: 1.3; }
      .item-subtitle { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem; }
      .item-badge { padding: 4px 0; border-radius: 4px; width: 40px; height: 4px; }
      .item-badge.income { background: var(--success); }
      .item-badge.expense { background: var(--warning); }
      .item-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-muted); padding-top: 0.8rem; border-top: 1px solid var(--border-color); }
    `;
    document.head.appendChild(style);
  }

  // State
  let currentDate = new Date();
  let selectedDate = new Date(); // To show in the right panel
  
  // Data
  let clientes: Cliente[] = [];
  let membros: Membro[] = [];
  let transacoes: import('../store').Transacao[] = [];

  const loadData = async () => {
    try {
      const [cRes, mRes, tRes] = await Promise.all([getClientes(), getMembros(), import('../store').then(m => m.getTransacoes())]);
      clientes = cRes;
      membros = mRes;
      transacoes = tRes;
      render();
    } catch (e: unknown) {
      showToast('Erro ao carregar dados do calendário.', 'error');
    }
  };

  const render = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const weekDays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

    // Find events for selected date to show in the right panel
    const selectedDay = selectedDate.getDate();
    const isSameMonth = selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
    const selectedIncomes = isSameMonth ? clientes.filter(c => c.data_pagamento === selectedDay && c.status === 'ativo') : [];
    const selectedExpenses = isSameMonth ? membros.filter(m => m.data_pagamento === selectedDay) : [];

    // Build Grid HTML
    let gridHTML = '';
    
    // Empty prefix cells
    for (let i = 0; i < firstDay; i++) {
      gridHTML += `<div class="calendar-day empty"></div>`;
    }

    // Days cells
    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
      const isToday = today.getDate() === i && today.getMonth() === month && today.getFullYear() === year;
      const isSelected = selectedDay === i && isSameMonth;
      
      const dayIncomes = clientes.filter(c => c.data_pagamento === i && c.status === 'ativo');
      const dayExpenses = membros.filter(m => m.data_pagamento === i);
      
      const hasEvents = dayIncomes.length > 0 || dayExpenses.length > 0;
      
      let eventsHTML = '';
      if (dayIncomes.length > 0) {
        eventsHTML += `<div class="event-pill income"><i class="ph ph-trend-up"></i> ${dayIncomes.length} Recebimento${dayIncomes.length > 1 ? 's' : ''}</div>`;
      }
      if (dayExpenses.length > 0) {
        eventsHTML += `<div class="event-pill expense"><i class="ph ph-trend-down"></i> ${dayExpenses.length} Despesa${dayExpenses.length > 1 ? 's' : ''}</div>`;
      }

      gridHTML += `
        <div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}" data-day="${i}">
          <span class="day-number">${i}</span>
          <div class="day-events">
            ${eventsHTML}
          </div>
        </div>
      `;
    }

    // Build right panel items HTML
    let panelItemsHTML = '';
    
    // Helper to check if paid
    const isPaid = (refId: string) => transacoes.some(t => t.referencia_agendamento === refId);

    if (selectedIncomes.length === 0 && selectedExpenses.length === 0) {
       panelItemsHTML = `<div style="text-align:center; padding: 2rem 0; color: var(--text-muted);"><i class="ph ph-calendar-x" style="font-size: 2.5rem; margin-bottom: 0.5rem; opacity: 0.5;"></i><p>Nenhuma movimentação neste dia.</p></div>`;
    } else {
      selectedIncomes.forEach(c => {
        const refId = `cliente_${c.id}_${year}_${String(month + 1).padStart(2, '0')}`;
        const paid = isPaid(refId);
        
        panelItemsHTML += `
          <div class="scheduled-item">
            <div class="item-top">
              <div>
                <div class="item-badge income" style="${paid ? 'background: var(--text-muted)' : ''}"></div>
                <div class="item-title" style="margin-top:0.8rem; ${paid ? 'text-decoration: line-through; color:var(--text-muted)' : ''}">${c.nome}</div>
                <div class="item-subtitle">Plano: ${c.plano || 'N/A'}</div>
              </div>
              <div>
                ${paid 
                  ? `<span class="badge" style="background:var(--surface-hover); color:var(--text-muted)"><i class="ph ph-check" style="margin-right:4px"></i>Pago</span>`
                  : `<button class="btn-primary btn-confirm-cal" style="padding: 0.4rem 0.8rem; font-size:0.8rem" 
                        data-refid="${refId}" data-desc="${c.nome}" data-val="${c.valor_mensal}" data-cat="Mensalidade Cliente" data-tipo="entrada">
                      <i class="ph ph-check-circle"></i> Confirmar
                    </button>`
                }
              </div>
            </div>
            <div class="item-meta">
              <i class="ph ph-money"></i> Previsto: R$ ${c.valor_mensal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </div>
          </div>
        `;
      });
      selectedExpenses.forEach(m => {
        const refId = `membro_${m.id}_${year}_${String(month + 1).padStart(2, '0')}`;
        const paid = isPaid(refId);

        panelItemsHTML += `
          <div class="scheduled-item">
            <div class="item-top">
              <div>
                <div class="item-badge expense" style="${paid ? 'background: var(--text-muted)' : ''}"></div>
                <div class="item-title" style="margin-top:0.8rem; ${paid ? 'text-decoration: line-through; color:var(--text-muted)' : ''}">${m.nome}</div>
                <div class="item-subtitle">Equipe - ${m.cargo} (${m.tipo.replace('_', ' ')})</div>
              </div>
              <div>
                ${paid 
                  ? `<span class="badge" style="background:var(--surface-hover); color:var(--text-muted)"><i class="ph ph-check" style="margin-right:4px"></i>Pago</span>`
                  : `<button class="btn-secondary btn-confirm-cal" style="padding: 0.4rem 0.8rem; font-size:0.8rem" 
                        data-refid="${refId}" data-desc="Pagto. ${m.nome}" data-val="${m.custo_mensal || 0}" data-cat="Pagamento Equipe" data-tipo="saida">
                      <i class="ph ph-check-circle"></i> Confirmar
                    </button>`
                }
              </div>
            </div>
            <div class="item-meta">
              <i class="ph ph-money"></i> Previsto: R$ ${(m.custo_mensal || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </div>
          </div>
        `;
      });
    }


    container.innerHTML = `
      <header class="header animate-up">
        <div class="header-title">
          <h1>Agenda & Pagamentos</h1>
          <p>Visão geral de recebimentos e despesas agendadas.</p>
        </div>
      </header>

      <div class="calendar-layout animate-up" style="animation-delay: 0.1s;">
        <!-- Left: Calendar Grid -->
        <div class="calendar-main">
          <div class="calendar-header">
            <div class="calendar-title-group">
              <h2>${monthNames[month]}</h2>
              <span>${year}</span>
            </div>
            <div class="calendar-nav">
              <button id="btn-prev-month"><i class="ph ph-caret-left"></i></button>
              <button id="btn-next-month"><i class="ph ph-caret-right"></i></button>
            </div>
          </div>
          <div class="calendar-weekdays">
            ${weekDays.map(wd => `<div>${wd}</div>`).join('')}
          </div>
          <div class="calendar-grid">
            ${gridHTML}
          </div>
        </div>

        <!-- Right: Scheduled Panel -->
        <div class="scheduled-panel">
          <div class="scheduled-header">
            <h3>Agendado</h3>
            <p>${selectedDate.getDate()} de ${monthNames[selectedDate.getMonth()]}, ${selectedDate.getFullYear()}</p>
          </div>
          <div class="scheduled-list custom-scrollbar">
            ${panelItemsHTML}
          </div>
        </div>
      </div>
    `;

    // Attach Events
    container.querySelector('#btn-prev-month')?.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      render();
    });

    container.querySelector('#btn-next-month')?.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      render();
    });

    container.querySelectorAll('.calendar-day').forEach(dayEl => {
      dayEl.addEventListener('click', () => {
        const dayStr = dayEl.getAttribute('data-day');
        if (dayStr) {
          selectedDate = new Date(year, month, parseInt(dayStr));
          render();
        }
      });
    });

    // Handle Confirmations 
    container.querySelectorAll('.btn-confirm-cal').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Avoid triggering day select if overlapping
        const el = btn as HTMLElement;
        const refId = el.dataset.refid!;
        const desc = el.dataset.desc!;
        const val = Number(el.dataset.val);
        const cat = el.dataset.cat!;
        const tipo = el.dataset.tipo as 'entrada' | 'saida';

        if(confirm(`Confirmar o recebimento/pagamento agendado de ${desc} (R$ ${val.toLocaleString('pt-BR')})?`)) {
          try {
            const { addTransacao } = await import('../store');
            await addTransacao({
               descricao: desc,
               detalhe: 'Baixa efetuada pelo Calendário',
               categoria: cat,
               valor: val,
               data: new Date().toISOString().split('T')[0],
               tipo: tipo,
               status: 'pago',
               referencia_agendamento: refId
            });
            showToast('Pagamento confirmado e gravado em Caixa!', 'success');
            await loadData(); // Reload to refresh checkmarks
          } catch (err: unknown) {
             showToast('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'), 'error');
          }
        }
      });
    });
  };

  // Entry Point
  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Agenda & Pagamentos</h1>
        <p>Carregando dados dos meses...</p>
      </div>
    </header>
    <div style="padding: 2rem; color: var(--text-muted); text-align: center;" class="animate-up">
      <i class="ph ph-circle-notch ph-spin" style="font-size: 2rem;"></i>
    </div>
  `;
  
  await loadData();
}
