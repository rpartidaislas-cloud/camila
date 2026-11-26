// SMYL PWA Service Worker
// Versión del cache — incrementar cuando se actualicen archivos
const CACHE_VERSION = 'smyl-v263-lana-connection-recovery-google-calendar-bidirectional-review-professional-invitations-appointment-negotiations-whatsapp-callbacks-patients-visual-v32-history-ux-v32-whatsapp-template-categories-treatment-ux-v32-smart-odontogram-v33-evidence-history-v34-simplified-navigation-patient-intake-v33-no-new-design-primary-evidence-ai-v35-evolution-closure-v36-daily-workbench-v12-meta-cards-v13-source-workspace-v37-clinical-task-panel-v38-single-odontogram-v39-radiograph-ui-v40-reading-workbench-v42-radiograph-navigation-v43-patient-summary-v44-patient-timeline-v45-team-roles-v46-team-layout-v47-radiograph-review-v2-v47-radiograph-report-v48-radiograph-longitudinal-v49-radiograph-validation-v50-radiograph-hardening-v51-radiograph-v1-json-v52-radiograph-v1-retry-v53-radiograph-v1-retry-fix-v54-radiograph-v1-diagnostic-v55-quiet-update-v56-radiograph-null-v57-radiograph-opus-v58-radiograph-boxes-v59-radiograph-units-v60-radiograph-order-v61-radiograph-lightbox-v62-radiograph-fit-v63-radiograph-map-v64-simulator-simple-v1-progressive-v2-premium-v3-radiograph-drag-v65-clinical-workspace-v33-v66-daily-home-scope-fix-v67-vita-carousel-v4-sidebar-v68-navy-studio-v5-history-dates-v68-history-structured-v69-patient-simulations-v70-navy-cleanup-v6-face-guide-v7-simulator-ux-v6-bleach-guide-v8-shade-compare-v9-bleach-bl-v10-result-views-v11-lana-unlink-v1-dialog-v2-voice-notes-v12-patient-open-fix-v1-history-focused-v71-topbar-cleanup-v72-evaluation-flow-v73-patient-summary-simple-v74-history-read-integration-v75-treatment-simple-v77-panel-audit-fase0-caja-citas-v1-aviso-panel-v2-lista-pacientes-v3-selector-diferido-v4-agenda-estatica-v5-tope-ia-v6-sondeo-adaptativo-v7-supabase-local-v8-anti-empalme-v9-errores-cliente-v10-proposal-pwa-compact-v1-evaluation-context-v78-patient-directory-v4-result-explicit-v12-patient-record-header-v79-pwa-manifest-v80-topbar-limpia-v81-treatment-tenant-workbench-v82-cobros-v82-plantillas-cobro-v83-cobro-whatsapp-v84-cobranza-v85-login-split-v86-odontogram-clinical-workbench-v87-cargo-fiscal-v86-buscador-pacientes-v87-google-login-v89-google-precheck-v90-cotizaciones-v88-messaging-center-cotizaciones-v1-professional-payment-flow-sentry-v1-smyl-v267-guided-collection-sentry-v1-legal-v96-sentry-on-v2-freeze-watchdog-v1-sidebar-v2-finance-tabs-v3-page-width-v1-pending-charges-v1-agenda-billing-v1-nav-pending-badge-v1-no-show-fee-v1-guided-collection-v2-account-v2-clinical-evidence-center-v1-catalog-v2-catalog-roles-v1-refund-roles-v1-radiograph-gallery-v1-settings-channels-v2-radiograph-queue-v2-catalog-inline-price-v1-settings-workspace-v3-whatsapp-workspace-v4-radiograph-reading-desk-v12-dashboard-operativo-v3-whatsapp-coexistence-v5-cash-reconciliation-v1-finance-history-corrections-v1-radiograph-decision-flow-v13-radiograph-context-crop-v14-radiograph-guided-process-v15-radiograph-multiscale-abstention-v16-clinical-photo-evidence-v1-radiograph-intake-v1-radiograph-tooth-picker-v17-radiograph-mobile-reading-v18-single-radiograph-intake-v1-radiograph-intake-runtime-fix-v1-radiograph-mobile-flow-v17-patient-mobile-submit-v1-radiograph-docked-odontogram-v20-radiograph-device-parity-zoom-v21-charge-select-clean-v1-evaluation-separation-v79-radiograph-single-action-v1-clinical-dictation-v1-charge-dialog-v2-dental-findings-v2-dental-history-evidence-v3-inventory-v2-movement-v1-professional-finance-v1-order-v1-material-v1-reponer-v1-inventory-roles-v1-seguimiento-v89-inventario-costos-v90-inventory-phase3-v1-sin-movimiento-v1-radiograph-mila-dictation-v1-importar-etiquetas-v1-radiograph-professional-writing-v2-cobros-material-v1-paciente-por-registrar-v1-registro-por-enlace-v1-inicio-compacto-v1-inicio-cobros-v1-agenda-alineacion-v1-inicio-por-rol-v1-agenda-nueva-cita-v1-cobros-hoy-v1-agenda-mes-v1-agenda-ronda2-v1-cobros-caja-v1-llego-sin-cita-v1-cobros-directo-v1-agenda-tarjetas-v1-consultorio-v1-visita-v1-canales-logos-v1-chat-limpio-v1-chat-calendario-v2-ficha360-v1-sucursales-proceso-v1-almacenamiento-v1-chat-sucursal-v1-precio-sucursal-v1-historia-preguntas-v1-microtexto-12px-v1-cierre-visita-v1-nube-v1-nube-compartir-v1-ficha360-v3-cotizacion-sucursal-v1-qr-registro-v1-alertas-medicas-v1-ia-sucursal-v1-nube-ia-v1-firma-aviso-v1-ficha-guias-v1-resumen-guardado-v1-capacitar-etapas-v1-agenda-chat-servicio-v1-agenda-dia-auto-v1-agenda-tablero-v1-bandeja-limpia-v1-horarios-claros-v1-ia-sucursales-vivas-v1-inbox-professional-v4-facturapi-sandbox-v1-capacitar-ejemplos-v1-facturacion-configuracion-v1-avisos-sucursal-v1-pdf-sucursal-v1-capacitar-ia-mejoras-v1-prueba-mismo-paso-v1-facturar-recibo-v1-timbrado-sandbox-v1-cancelacion-sandbox-v1-factura-correo-v1-acuse-cancelacion-v1-facturapi-plataforma-v1-inbox-professional-v5-vincular-paciente-v1-asistente-datos-vivos-v1-mensajes-citas-v1-skeletons-v1-ficha-ordenada-v1-agenda-sincroniza-chat-v1-avisos-cita-v5-clic-fuera-v1-vincular-chat-v1-ficha360-v4-finanzas-workspace-v5-datos-paciente-v1-expediente-orden-v2-constancia-domicilio-v1-constancia-chat-v1-equipo-profesional-v1-photo-review-mount-fix-v1-equipo-whatsapp-v1-equipo-horarios-v1-equipo-listo-v1-alta-whatsapp-v2-selector-consultorio-v1-cabecera-sin-s-v1-menu-selectores-v1-ficha-contexto-v1-caja-paginada-v1-csp-v1-agenda-pendientes-colapsables-v1-privacidad-derechos-v1-firma-aviso-remota-v1-privacidad-expediente-v2-privacidad-chat-v1-aviso-automatico-v1-candado-ia-v2-consentimiento-claro-v1-privacidad-por-paciente-v1-agenda-avisos-activos-v1-agenda-clic-horario-v1-chat-cita-agenda-v1-agenda-filtro-aviso-v1-cotizacion-estados-v1-iniciar-tratamiento-v1-cotizar-listos-v1-cotizar-ventana-v2-pago-en-linea-clinica-v1-cobro-enlace-v1-pagos-en-linea-openpay-v1-pagos-en-linea-diagnostico-v1-pagos-en-linea-paynet-v1-finanzas-pestanas-v6-finanzas-cobrar-pagos-v7-pagos-filtro-v8-cumplimiento-ia-v1agenda-avisos-activos-v1-agenda-clic-horario-v1-chat-cita-agenda-v1-agenda-filtro-aviso-v1-cotizacion-estados-v1-iniciar-tratamiento-v1-cotizar-listos-v1-cotizar-ventana-v2-pago-en-linea-clinica-v1-cobro-enlace-v1-pagos-en-linea-openpay-v1-pagos-en-linea-diagnostico-v1-pagos-en-linea-paynet-v1-finanzas-pestanas-v6-finanzas-cobrar-pagos-v7-pagos-filtro-v8-cumplimiento-ia-v1-cumplimiento-fase2-v1-receta-integrada-v1-ruta-tratamiento-v1-media-sugerencias-v1-finanzas-caja-facturacion-v9-finanzas-motor-v10-tratamientos-capitulos-v1-hallazgos-nuevos-v1-verificacion-anestesia-v1-sidebar-compacto-v1-buscador-sat-v1-sat-ia-v1-servicio-ia-v1-procedimiento-herramienta-v1-servicio-ia-v2-nube-organizar-v1-servicio-iva-v1-sat-diagnostico-v1-marca-smyl-v1-cobro-sucursal-v1-cobro-simple-v1-cumplimiento-carpeta-v1-equipo-whatsapp-v1-equipo-horarios-v1-equipo-listo-v1-planes-v1-openpay-v1-plan-consumo-v2-plantillas-estatus-v1-aviso-48h-v1';
const COMPOSER_TOOLBOX_CACHE = CACHE_VERSION + '-inbox-toolbox-v6-periodontograma-v4';
const CHAT_WRITING_TOOLS_CACHE = COMPOSER_TOOLBOX_CACHE + '-inbox-writing-tools-v7-picker-v8-atencion-v9-chat-access-v1-citas-pipeline-v2-panel-v2';
const ANATOMICAL_ODONTOGRAM_CACHE = CHAT_WRITING_TOOLS_CACHE + '-chat-media-v1-inbox-header-v1-thread-ux-v5-chat-compact-v2-evidence-single-entry-fix-v1-radiograph-anatomic-odontogram-v20-radiograph-mobile-workspace-v22-radiograph-visual-architecture-v23-radiograph-fit-action-v24-evidence-library-v25-radiograph-crop-view-v26-radiograph-unified-review-v27-patient-reload-continuity-v1-clinical-file-layout-v28-radiograph-crop-editor-v29';
const STATIC_CACHE = ANATOMICAL_ODONTOGRAM_CACHE + '-canales-cuentas-v1' + '-chat-control-icons-v1-inventory-policy-v1-collection-visual-v1-static-evidence-center-ux-v6-clinical-categories-v1-evidence-single-intake-v1-payments-ledger-ux-v1-evidence-workspace-v1-finance-workspace-v4-fiscal-receipts-v1-mila-interview-qr-v1-mila-voice-interview-v1-mila-dialog-v3-mila-live-orb-v1-mila-live-v2-summary-fix-v1-mila-orb-v3-mila-previsit-v1-orb-round-v1-online-pay-v1-oculto-v1-previsit-agenda-v1-mila-turnos-v1-mi-cuenta-personal-v1-mi-consultorio-v1-equipo-ficha-v1-branch-scope-v1-receipt-professional-v1-propuesta-compartida-v1-propuesta-aviso-v1-correcciones-revision-v1-quick-replies-v1-inbox-composer-rewrite-v1-lana-meta-attribution-v1-inicio-sin-nueva-cita-v1-branches-team-v2-branch-actions-v1-clinical-files-inset-v1-clinical-tools-v1-simulador-arreglos-v1-receta-base-v1-diseno-sonrisa-v1-receta-v1-ia-interruptor-v1-asistente-layout-v1-asistente-niveles-v1-agenda-ia-solicitud-v1-asistente-autollenado-v1-agenda-sin-nueva-cita-duplicada-v1-inbox-ocultar-mensaje-v1-agenda-error-envio-visible-v1';
const DYNAMIC_CACHE = ANATOMICAL_ODONTOGRAM_CACHE + '-collection-visual-v1-dynamic-evidence-center-ux-v6-clinical-categories-v1-evidence-single-intake-v1-payments-ledger-ux-v1-evidence-workspace-v1-finance-workspace-v4-fiscal-receipts-v1-lana-meta-attribution-v1';

// Archivos que se cachean al instalar
const STATIC_FILES = [
  '/camila/vendor/supabase-js-2.117.3.js',
  '/camila/smyl-browser-privacy.js?v=1',
  '/camila/smyl-sentry.js?v=3',
  '/camila/smyl-photo-url-refresh.js?v=1',
  '/camila/smyl-auth-guard.js?v=2',
  '/camila/smyl-freeze-watchdog.js?v=1',
  '/camila/smyl-freeze-watchdog-worker.js?v=1',
  '/camila/vendor/sentry-browser-10.78.0.min.js?v=1',
  '/camila/smyl-secure-files.js?v=2',
  '/camila/smyl-security-center.js?v=3',
  '/camila/smyl-security-center.css?v=2',
  '/camila/mila.html',
  '/camila/consumos.html',
  '/camila/smyl-consumption.js?v=11',
  '/camila/smyl-consumption.css?v=8',
  '/camila/smyl-dental-model.js?v=4',
  '/camila/smyl-periodontal-context.js?v=3',
  '/camila/smyl-radiograph-review-model.js?v=9',
  '/camila/smyl-radiograph-review-store.js?v=2',
  '/camila/smyl-radiograph-analysis-client.js?v=14',
  '/camila/smyl-radiograph-review.js?v=34',
  '/camila/smyl-radiograph-review.css?v=2',
  '/camila/smyl-radiograph-workbench.css?v=26',
  '/camila/smyl-radiograph-contracts.js?v=2',
  '/camila/smyl-radiograph-review-model-v2.js?v=1',
  '/camila/smyl-radiograph-report.js?v=3',
  '/camila/smyl-radiograph-report.css?v=1',
  '/camila/smyl-radiograph-longitudinal.js?v=2',
  '/camila/smyl-radiograph-longitudinal.css?v=1',
  '/camila/smyl-radiograph-validation.js?v=3',
  '/camila/smyl-radiograph-validation.css?v=1',
  '/camila/smyl-radiograph-review-v2.js?v=6',
  '/camila/smyl-radiograph-review-v2.css?v=3',
  '/camila/smyl-dental-dictation.js?v=2',
  '/camila/smyl-dental-dictation.css?v=2',
  '/camila/smyl-dental-finding-editor.js?v=2',
  '/camila/smyl-dental-finding-editor.css?v=2',
  '/camila/smyl-dental-record.js?v=35',
  '/camila/smyl-analysis-workflow.js?v=2',
  '/camila/smyl-photo-review-model.js?v=4',
  '/camila/smyl-photo-review-store.js?v=4',
  '/camila/smyl-photo-findings.js?v=1',
  '/camila/smyl-tooth-map.js?v=3',
  '/camila/smyl-review-evidence.js?v=2',
  '/camila/smyl-photo-review.js?v=5',
  '/camila/smyl-photo-review.css?v=3',
  '/camila/smyl-photo-analysis-client.js?v=3',
  '/camila/smyl-photo-analysis.js?v=6',
  '/camila/smyl-dental-record.css?v=6',
  '/camila/smyl-case-model.js?v=3',
  '/camila/smyl-case-client.js?v=3',
  '/camila/smyl-patient-cases.js?v=14',
  '/camila/my-smyl-document.js?v=1',
  '/camila/my-smyl-portal.js?v=5',
  '/camila/my-smyl-portal.css?v=2',
  '/camila/my-smyl.html',
  '/camila/my-smyl.js?v=4',
  '/camila/my-smyl-presentation.js?v=1',
  '/camila/my-smyl-presentation.css?v=1',
  '/camila/my-smyl-review.js?v=1',
  '/camila/my-smyl-review.css?v=1',
  '/camila/my-smyl.css?v=1',
  '/camila/my-smyl-studio.js?v=3',
  '/camila/my-smyl-studio.css?v=1',
  '/camila/smyl-gmail.js?v=2',
  '/camila/smyl-gmail.css?v=1',
  '/camila/icons/ui/my-smyl-example-before.svg',
  '/camila/icons/ui/my-smyl-example-after.svg',
  '/camila/smyl-patient-cases.css?v=4',
  '/camila/smyl-proposals.css?v=16',
  '/camila/smyl-prescription.css?v=1',
  '/camila/smyl-proposals.js?v=27',
  '/camila/smyl-proposal-model.js?v=4',
  '/camila/smyl-proposal-print.js?v=7',
  '/camila/smyl-prescription-model.js?v=1',
  '/camila/smyl-prescription-print.js?v=1',
  '/camila/smyl-prescriptions.js?v=1',
  '/camila/smyl-treatment-quote-stage3.js?v=1',
  '/camila/smyl-treatment-quote-stage3.css?v=3',
  '/camila/smyl-treatment-plan-model.js?v=1',
  '/camila/smyl-treatment-plan-client.js?v=2',
  '/camila/smyl-clinic.js?v=27',
  '/camila/smyl-history-model.js?v=3',
  '/camila/smyl-history-read.js?v=4',
  '/camila/smyl-patient-privacy-panel.js?v=5',
  '/camila/smyl-informed-consent.js?v=1',
  '/camila/smyl-informed-consent.css?v=1',
  '/camila/smyl-clinical-background.js?v=1',
  '/camila/smyl-procedure-safety.js?v=2',
  '/camila/smyl-patient-360.js?v=40',
  '/camila/smyl-mila-interview.js?v=7',
  '/camila/smyl-mila-interview.css?v=5',
  '/camila/vendor/qrcode-generator-1.4.4.js',
  '/camila/smyl-patient-360.css?v=23',
  '/camila/smyl-patient-privacy-panel.css?v=4',
  '/camila/smyl-patient-record-stage2.js?v=2',
  '/camila/smyl-patient-record-stage2.css?v=2',
  '/camila/smyl-evidence-model.js?v=2',
  '/camila/smyl-evidence-workspace.js?v=1',
  '/camila/smyl-evidence-workspace.css?v=1',
  '/camila/smyl-evidence-categories.js?v=1',
  '/camila/smyl-evidence-center.js?v=12',
  '/camila/smyl-evidence-center.css?v=8',
  '/camila/smyl-evidence-center-integration.js?v=12',
  '/camila/smyl-evidence-center-integration.css?v=7',
  '/camila/smyl-clinical-photo-service.js?v=2',
  '/camila/smyl-clinical-photo-review.js?v=5',
  '/camila/smyl-clinical-photo-review.css?v=2',
  '/camila/smyl-periodontal-mila.js?v=1',
  '/camila/smyl-periodontal-graph.js?v=3',
  '/camila/smyl-periodontal-guided-model.js?v=1',
  '/camila/smyl-periodontal-guided.js?v=1',
  '/camila/smyl-periodontal-review.js?v=3',
  '/camila/smyl-periodontal-mila.css?v=1',
  '/camila/smyl-periodontal-graph.css?v=2',
  '/camila/smyl-periodontal-review.css?v=3',
  '/camila/smyl-periodontal-guided.css?v=1',
  '/camila/smyl-guided-photos.js?v=1',
  '/camila/smyl-treatments.js?v=3',
  '/camila/smyl-case-workspace.js?v=51',
  '/camila/smyl-case-workspace.css?v=36',
  '/camila/smyl-clinic.css?v=13',
  '/camila/smyl-patients-directory.css?v=3',
  '/camila/smyl-clinical-model.js?v=3',
  '/camila/smyl-skeleton.js?v=1',
  '/camila/smyl-skeleton.css?v=1',
  '/camila/smyl-panel.js?v=7',
  '/camila/smyl-panel.css?v=5',
  '/camila/smyl-clinic-admin.js?v=28',
  '/camila/smyl-billing.js?v=1',
  '/camila/smyl-plan-usage.js?v=2',
  '/camila/smyl-clinic-admin.css?v=22',
  '/camila/smyl-professional-directory.js?v=14',
  '/camila/smyl-professional-directory.css?v=13',
  '/camila/smyl-design-system-v2.css?v=2',
  '/camila/smyl-ui-template-v3.css?v=10',
  '/camila/smyl-ui-datta-v4.css?v=2',
  '/camila/smyl-brand.css?v=1',
  '/camila/smyl-public-profile.css?v=1',
  '/camila/dentista.html',
  '/camila/resena.html',
  '/camila/smyl-dialog-system.js?v=4',
  '/camila/smyl-modal-guard.js?v=1',
  '/camila/smyl-dialog-system.css?v=3',
  '/camila/smyl-schedule-grid.js?v=2',
  '/camila/smyl-schedule-slots.js?v=1',
  '/camila/smyl-schedule-board.js?v=3',
  '/camila/smyl-branch-scope.js?v=4',
  '/camila/smyl-select-menu.js?v=1',
  '/camila/smyl-select-menu.css?v=1',
  '/camila/smyl-waitlist-core.js?v=2',
  '/camila/smyl-waitlist.js?v=2',
  '/camila/smyl-waitlist.css?v=1',
  '/camila/smyl-ai-scheduling.js?v=2',
  '/camila/smyl-ai-scheduling.css?v=2',
  '/camila/smyl-schedule.js?v=61',
  '/camila/smyl-google-calendar.js?v=3',
  '/camila/smyl-schedule-message.js?v=5',
  '/camila/smyl-schedule-setup.js?v=2',
  '/camila/smyl-reminders.js?v=5',
  '/camila/smyl-templates.css?v=7',
  '/camila/smyl-template-catalog.js?v=7',
  '/camila/smyl-templates.js?v=8',
  '/camila/smyl-messaging.css?v=1',
  '/camila/smyl-messaging.js?v=1',
  '/camila/smyl-schedule.css?v=38',
  '/camila/smyl-google-calendar.css?v=2',
  '/camila/smyl-schedule-setup.css?v=2',
  '/camila/smyl-service-catalog-model.js?v=4',
  '/camila/smyl-service-catalog.js?v=18',
  '/camila/smyl-service-catalog.css?v=6',
  '/camila/smyl-service-catalog-stage1.css?v=6',
  '/camila/smyl-inventory-routing.js?v=1',
  '/camila/smyl-inventory-procurement.js?v=2',
  '/camila/smyl-inventory.js?v=22',
  '/camila/smyl-inventory.css?v=15',
  '/camila/smyl-fiscal-rules.js?v=2',
  '/camila/smyl-fiscal-capture.js?v=4',
  '/camila/smyl-xlsx.js?v=1',
  '/camila/smyl-finance.js?v=73',
  '/camila/smyl-online-pay-setup.js?v=3',
  '/camila/smyl-online-pay-setup.css?v=2',
  '/camila/smyl-finance.css?v=54',
  '/camila/smyl-reports.js?v=4',
  '/camila/smyl-reports.css?v=6',
  '/camila/smyl-readiness.js?v=1',
  '/camila/smyl-readiness.css?v=2',
  '/camila/smyl-storage.js?v=1',
  '/camila/smyl-storage.css?v=1',
  '/camila/smyl-compliance.js?v=1',
  '/camila/smyl-compliance-model.js?v=1',
  '/camila/smyl-compliance.css?v=1',
  '/camila/smyl-privacy-rights.js?v=3',
  '/camila/smyl-privacy-dispatch.js?v=1',
  '/camila/smyl-privacy-rights.css?v=2',
  '/camila/smyl-notice-settings.js?v=1',
  '/camila/smyl-notice-settings.css?v=1',
  '/camila/smyl-appointment-notice.js?v=3',
  '/camila/smyl-appointment-notice.css?v=2',
  '/camila/smyl-cloud.js?v=5',
  '/camila/smyl-cloud.css?v=4',
  '/camila/smyl-media-replies.css?v=1',
  '/camila/smyl-media-replies.js?v=1',
  '/camila/smyl-training-autofill.js?v=1',
  '/camila/smyl-connections.js?v=31&media=1',
  '/camila/smyl-connections.css?v=21',
  '/camila/smyl-lana-handoff.js?v=8',
  '/camila/smyl-lana-handoff.css?v=2',
  '/camila/smyl-lana-attention.js?v=6',
  '/camila/smyl-lana-attention.css?v=1',
  '/camila/smyl-ia-interruptor.js?v=2',
  '/camila/smyl-ia-interruptor.css?v=1',
  '/camila/smyl-daily-home.js?v=21',
  '/camila/smyl-daily-home.css?v=17',
  '/camila/smyl-clinical-tools.js?v=2',
  '/camila/smyl-clinical-tools.css?v=1',
  '/camila/smyl-consultorio.js?v=14',
  '/camila/smyl-consultorio.css?v=9',
  '/camila/smyl-patient-quick.js?v=1',
  '/camila/smyl-visit-model.js?v=7',
  '/camila/smyl-privacy-notice.js?v=3',
  '/camila/smyl-history-interview.js?v=1',
  '/camila/smyl-dashboard-v2.css?v=2',
  '/camila/smyl-clinic-setup.js?v=8',
  '/camila/smyl-clinic-setup.css?v=5',
  '/camila/smyl-settings-hub.js?v=18',
  '/camila/smyl-settings-hub.css?v=6',
  '/camila/smyl-task-center.js?v=9',
  '/camila/smyl-task-center.css?v=1',
  '/camila/smyl-resilience.js?v=1',
  '/camila/smyl-resilience.css?v=1',
  '/camila/smyl-schedule-suggest.js?v=1',
  '/camila/smyl-visit-message.js?v=1',
  '/camila/smyl-inbox-calendar.js?v=4',
  '/camila/smyl-inbox-ficha.js?v=12',
  '/camila/smyl-chat-pdf.js?v=1',
  '/camila/smyl-chat-media-viewer.js?v=1',
  '/camila/smyl-chat-media-viewer.css?v=1',
  '/camila/smyl-privacy-inbox.js?v=2',
  '/camila/smyl-inbox.js?v=98&media=1',
  '/camila/assets/emoji/catalog-es-v1.json',
  '/camila/smyl-inbox.css?v=80',
  '/camila/smyl-privacy-inbox.css?v=1',
  '/camila/smyl-navigation.js?v=34',
  '/camila/smyl-navigation.css?v=15',
  '/camila/icons/brands/whatsapp.svg',
  '/camila/icons/brands/instagram.svg',
  '/camila/icons/brands/messenger.svg',
  '/camila/smyl-professional-v3.js?v=15',
  '/camila/smyl-professional-v3.css?v=13',
  '/camila/smyl-command-menu.js?v=5',
  '/camila/smyl-command-menu.css?v=3',
  '/camila/smyl-studio.js?v=33',
  '/camila/smyl-photo-batch.js?v=3',
  '/camila/smyl-result-viewer.js?v=2',
  '/camila/smyl-result-viewer.css?v=1',
  '/camila/smyl-analysis-model.js?v=1',
  '/camila/smyl-analysis-guides.js?v=1',
  '/camila/smyl-analysis-guides.css?v=2',
  '/camila/smyl-studio.css?v=32',
  '/camila/icons/ui/smyl-face-capture-guide-v2.webp',
  '/camila/smyl-simulation-workspace-v33.css?v=1',
  '/camila/smyl-clinical-review-v33.css?v=1',
  '/camila/smyl-clinical-review-v33.js?v=1',
  '/camila/icons/capture-frontal-v2.webp',
  '/camila/icons/capture-left-v2.webp',
  '/camila/icons/capture-right-v2.webp',
  '/camila/icons/capture-three-quarter-v2.webp',
  '/camila/icons/capture-extraoral-v3.webp',
  '/camila/icons/capture-intraoral-v3.webp',
  '/camila/icons/ui/capture-intraoral-left-v1.webp',
  '/camila/icons/ui/capture-intraoral-right-v1.webp',
  '/camila/icons/ui/dental-miniature-v1.webp',
  '/camila/smyl-vita-samples.js?v=3',
  '/camila/smyl-shade-carousel.js?v=2',
  '/camila/smyl-tooth-selection.js?v=1',
  '/camila/smyl-local-tone.js?v=5',
  '/camila/smyl-local-tone.css?v=3',
  '/camila/case-views.js?v=3',
  '/camila/simulacion.html',
  '/camila/simulacion-rapida.html',
  '/camila/revision-clinica.html',
  '/camila/lana-quick-bridge.js?v=1',
  '/camila/smile-modes.js?v=13',
  '/camila/visual-composition.js?v=6',
  '/camila/visual-simulation.js?v=33',
  '/camila/photo-reference.js?v=1',
  '/camila/dental-transfer.js?v=1',
  '/camila/dental-transfer.css?v=1',
  '/camila/visual-simulation.css?v=6',
  '/camila/contour-review.js?v=2',
  '/camila/contour-review.css?v=1',
  '/camila/tooth-boundaries.js?v=1',
  '/camila/photo-adjust.js',
  '/camila/photo-adjust.js?v=3',
  '/camila/manifest.json',
  '/camila/app.html',
  '/camila/calibracion.html',
  '/camila/biblioteca-carillas.html',
  '/camila/manifest-app.json',
  '/camila/icons/smyl_pwa.png',
  '/camila/icons/smyl_logo.png',
  '/camila/icons/icon-72.png',
  '/camila/icons/icon-96.png',
  '/camila/icons/icon-128.png',
  '/camila/icons/icon-144.png',
  '/camila/icons/icon-152.png',
  '/camila/icons/icon-192.png',
  '/camila/icons/icon-512.png',
  '/camila/icons/vita/vita-master-photo.webp',
  '/camila/icons/vita/veneer-ceramic-v2.webp',
  'https://raw.githubusercontent.com/rpartidaislas-cloud/camila/claude/camila-claude-clinical-analysis-sywxjv/mobile/www/assets/dental-library/natural-a1-v1/central-v3.png',
  'https://raw.githubusercontent.com/rpartidaislas-cloud/camila/claude/camila-claude-clinical-analysis-sywxjv/mobile/www/assets/dental-library/natural-a1-v1/lateral-v3.png',
  'https://raw.githubusercontent.com/rpartidaislas-cloud/camila/claude/camila-claude-clinical-analysis-sywxjv/mobile/www/assets/dental-library/natural-a1-v1/canine-v3.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,700;1,600&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
];

// Las rutas de STATIC_FILES se escriben con el prefijo /camila/ (GitHub Pages). En un dominio propio la app vive en
// la raíz, así que el prefijo se sustituye por el alcance real del service worker.
var SCOPE_PATH = new URL(self.registration.scope).pathname;
function scoped(url) {
  return url.indexOf('/camila/') === 0 ? SCOPE_PATH + url.slice('/camila/'.length) : url;
}

// ── INSTALL ──
self.addEventListener('install', function(e) {
  console.log('[SW] Installing SMYL PWA update...');
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      // Un recurso externo no debe impedir que se actualice toda la PWA.
      return Promise.all(STATIC_FILES.map(function(url) {
        return cache.add(new Request(scoped(url), { cache: 'reload' })).catch(function(err) {
          console.warn('[SW] File not cached:', url, err);
        });
      }));
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', function(e) {
  console.log('[SW] Activating...');
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== STATIC_CACHE && key !== DYNAMIC_CACHE;
        }).map(function(key) {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH ──
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  var target = new URL(url);
  // Las copias del chat y las miniaturas de proveedores se leen en la sesión actual.
  if (e.request.cache === 'no-store' || target.protocol === 'blob:' ||
      (target.origin !== self.location.origin && e.request.destination === 'image') ||
      /\/storage\/v1\/object\/(sign|authenticated)\//.test(target.pathname)) return;

  // Patient credentials are fragments; data/photos are POST no-store to Edge.
  // Never supply an offline simulator or cached navigation for this portal.
  if (new URL(url).pathname.endsWith('/my-smyl-private.html')) {
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(function(){
      return new Response('Conéctate a internet y abre nuevamente el enlace de tu clínica.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    }));
    return;
  }

  // No cachear llamadas a APIs (Supabase, Anthropic, Google)
  if (url.includes('supabase.co') || 
      url.includes('sentry.io') ||
      url.includes('anthropic.com') || 
      url.includes('googleapis.com/v1beta') ||
      url.includes('openai.com')) {
    return; // Fetch normal, sin cache
  }

  // Network first para HTML (siempre versión más reciente) -- cache:
  // 'no-store' para que ni el navegador use una copia intermedia de su
  // propio caché HTTP; sin esto, "red primero" podía seguir sirviendo un
  // HTML no tan fresco dentro de la ventana de cache-control del servidor.
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(function(response) {
        var clone = response.clone();
        caches.open(STATIC_CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/camila/simulacion-rapida.html').then(function(fallback) { return fallback || caches.match(scoped('/camila/simulacion-rapida.html')); });
        });
      })
    );
    return;
  }

  // Cache first para assets estáticos (fonts, icons)
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return new Response('', { status: 408 });
      });
    })
  );
});

// ── PUSH NOTIFICATIONS (futuro) ──
self.addEventListener('push', function(e) {
  if (!e.data) return;
  var data = e.data.json();
  self.registration.showNotification(data.title || 'SMYL', {
    body: data.body || 'Tienes una nueva simulación lista',
    icon: '/camila/icons/smyl_pwa.png',
    badge: '/camila/icons/smyl_pwa.png',
    data: { url: data.url || '/camila/simulacion-rapida.html' }
  });
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data.url || '/camila/simulacion-rapida.html')
  );
});
