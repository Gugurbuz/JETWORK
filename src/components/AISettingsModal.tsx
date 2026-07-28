import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { X, Save, RefreshCw, History, RotateCcw } from 'lucide-react';
import { supabase } from '../supabase';
import { nowIso } from '../lib/mapping';
import { DEFAULT_PROMPT_SETTINGS } from '../services/promptEngine';
import { PromptSettings, PromptVersion } from '../types';
import { toast } from 'sonner';
import { useDocumentStore } from '../store/useDocumentStore';

export const AISettingsModal: React.FC = () => {
  const showAISettingsModal = useUIStore(state => state.showAISettingsModal);
  const setShowAISettingsModal = useUIStore(state => state.setShowAISettingsModal);
  const promptSettings = useSettingsStore(state => state.promptSettings);
  const setPromptSettings = useSettingsStore(state => state.setPromptSettings);
  const contextDebug = useDocumentStore(state => state.lastAnalystContextDebug);
  const [localSettings, setLocalSettings] = useState<PromptSettings | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'personas' | 'fewshot' | 'memory' | 'versions'>('general');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (showAISettingsModal) {
      if (promptSettings) {
        setLocalSettings(JSON.parse(JSON.stringify(promptSettings)));
      } else {
        setLocalSettings(JSON.parse(JSON.stringify(DEFAULT_PROMPT_SETTINGS)));
      }
    }
  }, [showAISettingsModal, promptSettings]);

  if (!showAISettingsModal || !localSettings) return null;

  const handleSave = async () => {
    const note = window.prompt("Bu sürüm için bir not girin (İsteğe bağlı):", "Yeni Güncelleme");
    if (note === null) return; // User cancelled

    setIsSaving(true);
    try {
      const newVersion: PromptVersion = {
        id: Date.now().toString(),
        createdAt: Date.now(),
        versionNote: note || 'Manuel Güncelleme',
        systemInstruction: localSettings.systemInstruction,
        negativeConstraints: localSettings.negativeConstraints,
        cotInstruction: localSettings.cotInstruction,
        totInstruction: localSettings.totInstruction || '',
        reasoningFramework: localSettings.reasoningFramework || 'cot',
        rolePersonas: localSettings.rolePersonas,
        fewShotLibrary: localSettings.fewShotLibrary,
        contextWindowSize: localSettings.contextWindowSize ?? 10,
        memoryEnabled: localSettings.memoryEnabled ?? true
      };

      const updatedSettings = {
        ...localSettings,
        versions: [newVersion, ...(localSettings.versions || [])].slice(0, 20) // Keep last 20 versions
      };

      const { error } = await supabase.from('settings').upsert({
        id: 'prompts',
        data: updatedSettings,
        updated_at: nowIso(),
      });
      if (error) throw error;
      
      setPromptSettings(updatedSettings);
      setLocalSettings(updatedSettings);
      toast.success('Yapay zeka ayarları başarıyla kaydedildi.');
      setShowAISettingsModal(false);
    } catch (error) {
      console.error("Error saving prompt settings:", error);
      toast.error('Ayarlar kaydedilirken bir hata oluştu.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestore = (version: PromptVersion) => {
    if (window.confirm('Bu versiyona dönmek istediğinize emin misiniz? Mevcut kaydedilmemiş değişiklikleriniz kaybolacak.')) {
      const { id, createdAt, versionNote, versions, ...settingsToRestore } = version;
      setLocalSettings({
        ...(settingsToRestore as PromptSettings),
        versions: localSettings.versions // Keep current version history
      });
      toast.success('Versiyon yüklendi. Kalıcı yapmak için "Değişiklikleri Kaydet" butonuna basın.');
      setActiveTab('general');
    }
  };

  const handleReset = () => {
    if (window.confirm('Tüm ayarları varsayılan (kod içindeki) değerlere döndürmek istediğinize emin misiniz?')) {
      setLocalSettings(JSON.parse(JSON.stringify(DEFAULT_PROMPT_SETTINGS)));
    }
  };

  const renderGeneralTab = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Sistem Talimatı (System Instruction)
        </label>
        <textarea
          className="w-full h-32 p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white font-mono text-sm"
          value={localSettings.systemInstruction}
          onChange={(e) => setLocalSettings({ ...localSettings, systemInstruction: e.target.value })}
        />
        <p className="text-xs text-gray-500 mt-1">Ana asistanın (JetWork AI) temel karakteri ve kuralları.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Negatif Kısıtlamalar (Negative Constraints)
        </label>
        <textarea
          className="w-full h-32 p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white font-mono text-sm"
          value={localSettings.negativeConstraints}
          onChange={(e) => setLocalSettings({ ...localSettings, negativeConstraints: e.target.value })}
        />
        <p className="text-xs text-gray-500 mt-1">Tüm ajanların uyması gereken kesin yasaklar (örn: halüsinasyon yapma, JSON dönme).</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Akıl Yürütme Çerçevesi (Reasoning Framework)
        </label>
        <select
          className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white text-sm mb-4"
          value={localSettings.reasoningFramework || 'cot'}
          onChange={(e) => setLocalSettings({ ...localSettings, reasoningFramework: e.target.value as any })}
        >
          <option value="standard">Standart (Ekstra Akıl Yürütme Yok)</option>
          <option value="cot">Chain of Thought (Adım Adım Düşünme)</option>
          <option value="tot">Tree of Thoughts (Çoklu Olasılık Değerlendirme)</option>
        </select>
      </div>

      {localSettings.reasoningFramework === 'cot' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Akıl Yürütme Talimatı (CoT Instruction)
          </label>
          <textarea
            className="w-full h-32 p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white font-mono text-sm"
            value={localSettings.cotInstruction}
            onChange={(e) => setLocalSettings({ ...localSettings, cotInstruction: e.target.value })}
          />
          <p className="text-xs text-gray-500 mt-1">Ajanların karar vermeden önce izlemesi gereken düşünce adımları.</p>
        </div>
      )}

      {localSettings.reasoningFramework === 'tot' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            İleri Düzey Akıl Yürütme Talimatı (ToT Instruction)
          </label>
          <textarea
            className="w-full h-32 p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white font-mono text-sm"
            value={localSettings.totInstruction || ''}
            onChange={(e) => setLocalSettings({ ...localSettings, totInstruction: e.target.value })}
          />
          <p className="text-xs text-gray-500 mt-1">Ajanların karar vermeden önce birden fazla olasılığı değerlendirmesini sağlayan talimat.</p>
        </div>
      )}
    </div>
  );

  const renderPersonasTab = () => (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Otonom ajanların (BA, IT, QA vb.) davranışlarını, görevlerini ve metodolojilerini buradan düzenleyebilirsiniz.
      </p>
      {Object.entries(localSettings.rolePersonas).map(([role, persona]) => (
        <div key={role}>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {role} Personası
          </label>
          <textarea
            className="w-full h-24 p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white font-mono text-sm"
            value={persona}
            onChange={(e) => {
              const newPersonas = { ...localSettings.rolePersonas, [role]: e.target.value };
              setLocalSettings({ ...localSettings, rolePersonas: newPersonas });
            }}
          />
        </div>
      ))}
    </div>
  );

  const renderFewShotTab = () => (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Ajanların çıktı üretirken feyzalacağı "Altın Örnekler" (Few-Shot Examples).
      </p>
      {Object.entries(localSettings.fewShotLibrary).map(([role, example]) => (
        <div key={role}>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {role} Örnek Çıktısı
          </label>
          <textarea
            className="w-full h-32 p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white font-mono text-sm"
            value={example}
            onChange={(e) => {
              const newFewShot = { ...localSettings.fewShotLibrary, [role]: e.target.value };
              setLocalSettings({ ...localSettings, fewShotLibrary: newFewShot });
            }}
          />
        </div>
      ))}
    </div>
  );

  const renderMemoryTab = () => (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
        <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">Bağlam Penceresi (Context Window) Stratejisi</h3>
        <p className="text-xs text-blue-600 dark:text-blue-400">
          Uzun konuşmalarda önemli bilgilerin kaybolmaması için "Akıllı Özetleme" ve "Önem Sıralı Bellek" mekanizmaları kullanılır.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Kurumsal Hafıza (RAG) Aktif
          </label>
          <p className="text-xs text-gray-500 mt-1">Geçmiş konuşmalardan önemli bilgileri çıkarıp saklar ve gerektiğinde bağlama ekler.</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input 
            type="checkbox" 
            className="sr-only peer"
            checked={localSettings.memoryEnabled ?? true}
            onChange={(e) => setLocalSettings({ ...localSettings, memoryEnabled: e.target.checked })}
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Aktif Bağlam Bütçesi (Seviye)
        </label>
        <input
          type="number"
          min="4"
          max="20"
          className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white text-sm"
          value={localSettings.contextWindowSize ?? 10}
          onChange={(e) => setLocalSettings({ ...localSettings, contextWindowSize: parseInt(e.target.value) || 10 })}
        />
        <p className="text-xs text-gray-500 mt-1">
          Ham mesaj sayısı yerine yaklaşık token bütçesini belirler. Her seviye yaklaşık 600 token’dır; eski konuşmalar mevcut turdan önce özetlenir.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Son AI turu bağlam denetimi</h3>
        {!contextDebug ? (
          <p className="mt-2 text-xs text-gray-500">Bu oturumda henüz hazırlanmış bir AI bağlamı yok.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600 dark:text-gray-300">
            <div><span className="font-semibold">Yaklaşık token:</span> {contextDebug.approximateRecentTokens}</div>
            <div><span className="font-semibold">Seçilen mesaj:</span> {contextDebug.selectedMessageIds.length}</div>
            <div><span className="font-semibold">Özetlenen mesaj:</span> {contextDebug.summarizedMessageCount}</div>
            <div><span className="font-semibold">Dışlanan kayıt:</span> {contextDebug.excludedMessageIds.length}</div>
            <div><span className="font-semibold">RAG kaynağı:</span> {contextDebug.selectedKnowledgeIds.length}</div>
            <div><span className="font-semibold">Hafıza kaydı:</span> {contextDebug.selectedMemoryIds.length}</div>
            <div><span className="font-semibold">Yaşayan belge:</span> {contextDebug.artifactPresent ? 'Dahil' : 'Yok'}</div>
            <div className="col-span-2 break-all">
              <span className="font-semibold">Belge revizyonu:</span>{' '}
              {contextDebug.artifactRevisionId || (contextDebug.artifactPresent ? 'Eski metadata yok' : 'Yok')}
            </div>
            <div className="col-span-2 break-all">
              <span className="font-semibold">Mesaj kimlikleri:</span>{' '}
              {contextDebug.selectedMessageIds.join(', ') || 'Yok'}
            </div>
            <div className="col-span-2 break-all">
              <span className="font-semibold">Bilgi kaynağı kimlikleri:</span>{' '}
              {contextDebug.selectedKnowledgeIds.join(', ') || 'Yok'}
            </div>
            <div className="col-span-2 break-all">
              <span className="font-semibold">Hafıza kimlikleri:</span>{' '}
              {contextDebug.selectedMemoryIds.join(', ') || 'Yok'}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderVersionsTab = () => {
    const versionsList = localSettings.versions || [];
    
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Geçmişte kaydedilen prompt versiyonları. Bir versiyona geri dönmek için "Geri Yükle" butonuna tıklayın.
        </p>
        {versionsList.length === 0 ? (
          <div className="text-center py-8 text-gray-500">Henüz kaydedilmiş bir versiyon bulunmuyor.</div>
        ) : (
          <div className="space-y-3">
            {versionsList.map((version) => (
              <div key={version.id} className="flex items-center justify-between p-4 border rounded-lg dark:border-gray-700 bg-white dark:bg-gray-800">
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white">{version.versionNote}</h4>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(version.createdAt).toLocaleString('tr-TR')}
                  </p>
                </div>
                <button
                  onClick={() => handleRestore(version)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                >
                  <RotateCcw className="w-4 h-4" />
                  Geri Yükle
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b dark:border-gray-800">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">Yapay Zeka Ayarları (LLMOps)</h2>
            <p className="text-sm text-gray-500">Sistem promptlarını ve ajan davranışlarını kodsuz yönetin.</p>
          </div>
          <button onClick={() => setShowAISettingsModal(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b dark:border-gray-800 px-4">
          <button
            className={`py-3 px-4 text-sm font-medium border-b-2 ${activeTab === 'general' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            onClick={() => setActiveTab('general')}
          >
            Genel Kurallar
          </button>
          <button
            className={`py-3 px-4 text-sm font-medium border-b-2 ${activeTab === 'personas' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            onClick={() => setActiveTab('personas')}
          >
            Ajan Rolleri
          </button>
          <button
            className={`py-3 px-4 text-sm font-medium border-b-2 ${activeTab === 'fewshot' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            onClick={() => setActiveTab('fewshot')}
          >
            Örnek Çıktılar
          </button>
          <button
            className={`py-3 px-4 text-sm font-medium border-b-2 ${activeTab === 'memory' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            onClick={() => setActiveTab('memory')}
          >
            Bellek & Bağlam
          </button>
          <button
            className={`py-3 px-4 text-sm font-medium border-b-2 ${activeTab === 'versions' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'} flex items-center gap-2`}
            onClick={() => setActiveTab('versions')}
          >
            <History className="w-4 h-4" />
            Geçmiş Versiyonlar
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'general' && renderGeneralTab()}
          {activeTab === 'personas' && renderPersonasTab()}
          {activeTab === 'fewshot' && renderFewShotTab()}
          {activeTab === 'memory' && renderMemoryTab()}
          {activeTab === 'versions' && renderVersionsTab()}
        </div>

        {/* Footer */}
        <div className="p-4 border-t dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50 rounded-b-lg">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            <RefreshCw className="w-4 h-4" />
            Varsayılana Dön
          </button>
          
          <div className="flex gap-2">
            <button
              onClick={() => setShowAISettingsModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              İptal
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
